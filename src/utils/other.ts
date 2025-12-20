const removeFormattingCodes = (str: string): string => str.replaceAll(/§./g, '');

const escapeValueNewlines = (str) =>
	str.replaceAll(/(": *"(?:\\"|[^"])+")/g, (_, match) => match.replaceAll('\n', '\\n'));

function colorString(color: number): string {
	const formatting = [
		'black',
		'dark_blue',
		'dark_green',
		'dark_aqua',
		'dark_red',
		'dark_purple',
		'gold',
		'gray',
		'dark_gray',
		'blue',
		'green',
		'aqua',
		'red',
		'light_purple',
		'yellow',
		'white',
		'obfuscated',
		'bold',
		'strikethrough',
		'underlined',
		'italic',
		'reset',
	];
	if (color === undefined || color > 21 || color === -1) return 'reset';
	return formatting[color];
}

export { removeFormattingCodes, escapeValueNewlines, colorString };
