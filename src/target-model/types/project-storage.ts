export const mojoProjectBaseStateField = "_base";

export function mojoProjectFieldStoragePath(
  inheritanceDepth: number,
  fieldName: string,
): readonly string[] {
  if (!Number.isSafeInteger(inheritanceDepth) || inheritanceDepth < 0) {
    throw new Error("A project field storage path requires a proved inheritance depth.");
  }
  return Object.freeze([
    ...Array.from({ length: inheritanceDepth }, () => mojoProjectBaseStateField),
    fieldName,
  ]);
}
