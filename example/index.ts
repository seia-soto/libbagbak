import {useUsbDevice} from '../src/device.js';
import {pull} from '../src/index.js';

(async () => {
	const device = await useUsbDevice();

	for (let i = 0; i < 5; i++) {
		const hasFailed = await pull(device, {
			hint: 'com.nexon.bluearchive',
			outdir: './dump',
			useExtensions: true,
			useColdBootedApplication: true,
		})
			.catch(error => {
				console.error(error);

				return true;
			});

		if (!hasFailed) {
			break;
		}
	}
})();
