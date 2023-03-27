import {DeviceManager, getUsbDevice, type Device, type GetDeviceOptions, type RemoteDeviceOptions} from 'frida';

export enum Errors {
	ApplicationNotFound = 'APPLICATION_NOT_FOUND: Application should be installed',
}

export const useRemoteDevice = async (addr: string, opts?: RemoteDeviceOptions) => {
	const manager = new DeviceManager();

	await manager.addRemoteDevice(addr, opts);

	const [device] = await manager.enumerateDevices();

	return device;
};

export const useUsbDevice = async (opts?: GetDeviceOptions) => getUsbDevice(opts);

export const useApplicationProcess = async (device: Device, hint: string, useColdBootedApplication: boolean) => {
	const application = (await device.enumerateApplications()).find(application => application.identifier === hint || application.name === hint);

	if (!application) {
		throw new Error(Errors.ApplicationNotFound);
	}

	if (!application.pid) {
		const pid = await device.spawn(hint);

		await device.resume(pid)
			.catch(_ => 0);

		return pid;
	}

	const frontmostApplication = await device.getFrontmostApplication();

	if (frontmostApplication && frontmostApplication.pid !== application.pid) {
		await device.kill(frontmostApplication.pid);
	}

	if (useColdBootedApplication) {
		await device.kill(application.pid);
	}

	const pid = await device.spawn(hint);

	await device.resume(pid)
		.catch(_ => 0);

	return pid;
};
