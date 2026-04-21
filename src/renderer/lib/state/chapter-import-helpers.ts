export function generateChapterTitleFromFilename(
  filePath: string,
  existingTitles: string[]
): string {
  const basename = filePath.split(/[/\\]/).pop() || 'unnamed';
  const nameWithoutExt = basename.replace(/\.[^/.]+$/, '');

  if (!existingTitles.includes(nameWithoutExt)) {
    return nameWithoutExt;
  }

  let counter = 1;
  while (existingTitles.includes(`${nameWithoutExt}_${counter}`)) {
    counter += 1;
  }

  return `${nameWithoutExt}_${counter}`;
}
