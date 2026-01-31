export type UUIDVersion =
    | 1
    | 2
    | 3
    | 4
    | 5
    | "invalid";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getUUIDVersion(uuid: string): UUIDVersion {
    if (!UUID_REGEX.test(uuid)) return "invalid";

    const versionChar = uuid[14]; // first char of 3rd block
    const version = parseInt(versionChar, 16);

    if (version >= 1 && version <= 5) return version as UUIDVersion;

    return "invalid";
}