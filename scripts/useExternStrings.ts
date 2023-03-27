import {readFile, writeFile} from 'fs/promises';

const out = './src/__generated__/strings.ts';
const mappings = [
	{
		name: 'cModule',
		src: './bagbak/cmod/source.c',
	},
	{
		name: 'jsAgent',
		src: './bagbak/dist/agent.js',
	},
];

const useEmbeddedStrings = mappings.map(async mapping => {
	const buff = await readFile(mapping.src);
	const text = buff.toString();

	// Use JSON for safe text embedding
	return `export const ${mapping.name}Strings = \`${text.replace(/([`$\\])/g, '\\$1')}\`;`;
});

(async () => {
	const header = '/* eslint-disable */';
	const source = await Promise.all(useEmbeddedStrings);

	await writeFile(out, [header, ...source].join('\n'));
})();
