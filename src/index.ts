import {type Device} from 'frida';
import {ScriptRuntime} from 'frida/dist/script.js';
import path from 'path';
import {useBridge, type Foreign, type PullingContext} from './bridge.js';
import {useApplicationProcess} from './device.js';
import {cModuleStrings, jsAgentStrings} from './__generated__/strings.js';

type OptionalPullingOptions = {
	useExtensions: boolean;
	useColdBootedApplication: boolean;
};

type RequiredPullingOptions = {
	hint: string;
	outdir: string;
};

type InternalPullingOptions = RequiredPullingOptions & OptionalPullingOptions;

export type PullingOptions = RequiredPullingOptions & Partial<OptionalPullingOptions>;

export const usePullingContext = async (device: Device, pid: string | number, opts: InternalPullingOptions & {basedir?: string}) => {
	const session = await device.attach(pid);
	const script = await session.createScript(jsAgentStrings, {
		runtime: ScriptRuntime.QJS,
	});

	await script.load();

	const foreign = script as Foreign;
	const basedir = opts.basedir ?? await foreign.exports.base();

	const context: PullingContext = {
		session,
		foreign,
		outdir: path.join(opts.outdir, 'Payload', path.basename(basedir)),
		basedir,
	};

	return context;
};

export const pull = async (device: Device, _opts: PullingOptions) => {
	_opts.useExtensions ??= true;
	_opts.useColdBootedApplication ??= true;

	const opts = _opts as InternalPullingOptions;

	const pid = await useApplicationProcess(device, opts.hint, opts.useColdBootedApplication);
	const main = await usePullingContext(device, pid, opts);

	useBridge(main);

	await main.foreign.exports.prepare(cModuleStrings);
	await main.foreign.exports.dump({
		executableOnly: false,
	});

	if (opts.useExtensions) {
		const init = {...opts, basedir: main.basedir};
		const pkd = await usePullingContext(device, 'pkd', init);

		await pkd.foreign.exports.skipPkdValidationFor(pkd.session.pid);

		for (const pid of await pkd.foreign.exports.launchAll()) {
			if (pid === 0) {
				continue;
			}

			if (await pkd.foreign.exports.jetsam(pid) !== 0) {
				throw new Error('PULL_UNCHAINING_PID_FAILED');
			}

			const plugin = await usePullingContext(device, pid, init);

			useBridge(plugin);

			await plugin.foreign.exports.prepare(cModuleStrings);
			await plugin.foreign.exports.dump({
				executableOnly: true,
			});
			await plugin.foreign.unload();
			await plugin.session.detach();
			await device.kill(pid);
		}

		await pkd.foreign.unload();
		await pkd.session.detach();
	}

	await main.foreign.unload();
	await main.session.detach();
	await device.kill(pid);
};
