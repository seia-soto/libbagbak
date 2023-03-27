# libbagbak

The library port of [bagbak](https://github.com/ChiChou/bagbak).
The version will be updated as `bagbak` updates, and all thanks should be go for the bagbak contributors.

- 📦 Bundling ready
- ✨ Fully typed

----

# Usage

> **Warning** This library only supports ESM format.

You can try out the following example after cloning this repository via `pnpm ts-node-esm ./example/index.js` after connecting Frida device via USB.

```typescript
import {useUsbDevice} from 'libbagbak/device.js';
import {pull} from 'libbagbak';

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
```

The `pull` function takes Frida `Device` and options to pull out decrypted application from the device.
In the output directory, you'll see the following directory structure: `{outdir}/Payload/{applicationName}/`.

See the followings for the options:

## Pulling options

- **hint*** (string) The application bundle identifier. (Example: `com.8bit.bitwarden`, `com.nexon.bluearchive`)
- **outdir** (string) The output directory.
- **useExtensions** (boolean) `true` if you want to decrypt extensions. (Optional, Default: `true`)
- **useColdBootedApplication** (boolean) `true` if you want to kill the target application if already opened. (Optional, Default: `true`)

## Exporting as IPA

The IPA file format is basically same as `zip`.
You can use `adm-zip` for zipping on Node.JS.

We won't handle zipping it on here to make the library portable.

# Development

We match the original `bagbak` version and use submodules for code access.
See [`scripts/build.sh`](scripts/build.sh) for more information how libbagbak references bagbak's code.

# License

The license of this project is same with the original repository (bagbak), and distributed under MIT license.
