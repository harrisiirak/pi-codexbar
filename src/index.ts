export function main(): string {
  return 'pi-codexbar scaffold initialized';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(main());
}
