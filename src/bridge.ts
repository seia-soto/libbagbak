import {type ScriptMessageHandler, type Message, type Script, type Session} from 'frida';
import {existsSync, type Stats} from 'fs';
import {mkdir, open, stat, type FileHandle} from 'fs/promises';
import path from 'path';

export type Foreign = Script & {
	exports: {
		base: () => Promise<string>;
		prepare: (cModule: string) => Promise<void>;
		dump: (opts: {executableOnly: boolean}) => Promise<void>;
		skipPkdValidationFor: (pid: string | number) => Promise<void>;
		launchAll: () => Promise<number[]>;
		jetsam: (pid: string | number) => Promise<number>;
	};
};

export type PullingContext = {
	session: Session;
	foreign: Foreign;
	basedir: string;
	outdir: string;
};

const useLocalPath = async (context: PullingContext, remotePath: string) => {
	const file = path.resolve(context.outdir, path.relative(context.basedir, remotePath));
	const bdir = path.dirname(file);

	if (!existsSync(bdir) || !(await stat(bdir)).isDirectory()) {
		await mkdir(bdir, {recursive: true});
	}

	return file;
};

enum BlobTypes {
	Unnamed = 0,
	Named = 1,
}

type Blob = {
	type: BlobTypes;
	size: number;
};

type UnnamedBlob = Blob & {
	type: BlobTypes.Unnamed;
	index: number;
	chunks: Buffer[];
};

type NamedBlob = Blob & {
	type: BlobTypes.Named;
	filename: string;
	descriptor: FileHandle;
};

const useBlobStore = () => new Map<string, UnnamedBlob | NamedBlob>();

type MemcpyPayload = {
	event: string;
	session: string; // Identifier of the blob
	size: number;
	index: number;
};

const handleMemcpy = async (store: ReturnType<typeof useBlobStore>, payload: MemcpyPayload, data?: Buffer) => {
	switch (payload.event) {
		case 'begin': {
			store.set(payload.session, {
				type: BlobTypes.Unnamed,
				size: payload.size,
				index: 0,
				chunks: [],
			});

			break;
		}

		case 'data': {
			const blob = store.get(payload.session);

			if (!blob) {
				throw new Error('BRIDGE_MEMCPY_BLOB_INVALID_SESSION_ID');
			}

			if (blob.type !== BlobTypes.Unnamed) {
				throw new Error('BRIDGE_MEMCPY_BLOB_INVALID_TYPE');
			}

			if (payload.index !== blob.index + 1) {
				throw new Error('BRDIGE_MEMCPY_BLOB_INVALID_INDEX');
			}

			if (data) {
				blob.chunks.push(Buffer.from(data));
				blob.index += 1;
			}

			break;
		}

		default: {
			break;
		}
	}
};

type DownloadPayload = {
	event: string;
	session: string; // Identifier
	stat: Stats;
	filename: string;
};

const handleDownload = async (context: PullingContext, blobStore: ReturnType<typeof useBlobStore>, payload: DownloadPayload, data?: Buffer) => {
	switch (payload.event) {
		case 'begin': {
			const outPath = await useLocalPath(context, payload.filename);
			const descriptor = await open(outPath, 'w', payload.stat.mode);

			blobStore.set(payload.session, {
				type: BlobTypes.Named,
				size: 0,
				descriptor,
				filename: payload.filename,
			});

			break;
		}

		case 'data': {
			const blob = blobStore.get(payload.session);

			if (!blob) {
				throw new Error('BRIDGE_DOWNLOAD_BLOB_INVALID_SESSION_ID');
			}

			if (blob.type !== BlobTypes.Named) {
				throw new Error('BRIDGE_DOWNLOAD_BLOB_INVALID_TYPE');
			}

			if (data) {
				blob.size += data.length;

				await blob.descriptor.write(data);
			}

			break;
		}

		case 'end': {
			const blob = blobStore.get(payload.session);

			if (!blob) {
				throw new Error('BRIDGE_DOWNLOAD_BLOB_INVALID_SESSION_ID');
			}

			if (blob.type !== BlobTypes.Named) {
				throw new Error('BRIDGE_DOWNLOAD_BLOB_INVALID_TYPE');
			}

			await blob.descriptor.close();

			blobStore.delete(payload.session);

			break;
		}

		default: {
			break;
		}
	}
};

type PatchPayload = {
	offset: number;
	blob: string;
	size: number;
	filename: string;
};

const handlePatch = async (context: PullingContext, blobStore: ReturnType<typeof useBlobStore>, payload: PatchPayload) => {
	const outPath = await useLocalPath(context, payload.filename);
	const descriptor = await open(outPath, 'r+');

	let buffer: Buffer | undefined;

	if (typeof payload.blob === 'string') {
		const blob = blobStore.get(payload.blob);

		if (!blob) {
			throw new Error('BRIDGE_PATCH_BLOB_NOT_FOUND');
		}

		if (blob.type !== BlobTypes.Unnamed) {
			throw new Error('BRIDGE_PATCH_BLOB_INVALID_TYPE');
		}

		buffer = Buffer.concat(blob.chunks);
	} else if (payload.size) {
		buffer = Buffer.alloc(payload.size);
	}

	if (!buffer) {
		await descriptor.close();

		throw new Error('BRIDGE_PATCH_BLOB_MISLEAD');
	}

	await descriptor.write(buffer, 0, buffer.length, payload.offset);
	await descriptor.close();
};

const useBlockingQueue = (handler: (message: Message, data?: Buffer) => Promise<unknown>) => {
	const queue: Array<{message: Message; data?: Buffer}> = [];
	let isLocked = false;

	const activator = async () => {
		if (isLocked) {
			return;
		}

		isLocked = true;

		for (; ;) {
			const container = queue.shift();

			if (!container) {
				isLocked = false;

				break;
			}

			await handler(container.message, container.data);
		}
	};

	const interceptor: ScriptMessageHandler = (message, data) => {
		queue.push({message, data: data ?? undefined});

		void activator();
	};

	return interceptor;
};

export const useBridge = (context: PullingContext) => {
	const blobStore = useBlobStore();

	const handler = async (message: Message, data?: Buffer) => {
		if (message.type === 'error') {
			return;
		}

		if (message.type !== 'send') {
			return;
		}

		const {subject} = message.payload as {subject: string};

		switch (subject) {
			case 'memcpy': {
				await handleMemcpy(blobStore, message.payload as MemcpyPayload, data ?? undefined);

				break;
			}

			case 'download': {
				await handleDownload(context, blobStore, message.payload as DownloadPayload, data ?? undefined);

				break;
			}

			case 'patch': {
				await handlePatch(context, blobStore, message.payload as PatchPayload);

				break;
			}

			default: {
				break;
			}
		}

		context.foreign.post({type: 'ack'}, Buffer.allocUnsafe(1));
	};

	context.foreign.message.connect(useBlockingQueue(handler));
};
