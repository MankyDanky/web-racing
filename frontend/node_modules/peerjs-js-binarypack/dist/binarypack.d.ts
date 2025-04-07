export type Packable = null | undefined | string | number | boolean | Date | ArrayBuffer | Blob | Array<Packable> | {
    [key: string]: Packable;
} | ({
    BYTES_PER_ELEMENT: number;
} & ArrayBufferView);
export type Unpackable = null | undefined | string | number | boolean | ArrayBuffer | Array<Unpackable> | {
    [key: string]: Unpackable;
};
export function unpack<T extends Unpackable>(data: ArrayBuffer): T;
export function pack(data: Packable): ArrayBuffer | Promise<ArrayBuffer | SharedArrayBuffer>;
export class Packer {
    getBuffer(): ArrayBufferLike;
    pack(value: Packable): Promise<void> | undefined;
    pack_bin(blob: Uint8Array): void;
    pack_string(str: string): void;
    pack_array(ary: Packable[]): void | Promise<void>;
    pack_integer(num: number): void;
    pack_double(num: number): void;
    pack_object(obj: {
        [key: string]: Packable;
    }): void | Promise<void>;
    pack_uint8(num: number): void;
    pack_uint16(num: number): void;
    pack_uint32(num: number): void;
    pack_uint64(num: number): void;
    pack_int8(num: number): void;
    pack_int16(num: number): void;
    pack_int32(num: number): void;
    pack_int64(num: number): void;
}

//# sourceMappingURL=binarypack.d.ts.map
