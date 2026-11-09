"""Normalize Chinese glyph variants with macOS's built-in ICU, without a model."""
import ctypes
import re
from functools import lru_cache


NUMBER = re.compile(r'[0-9零〇一二两三四五六七八九十百千万亿]+')
DIGITS = dict(zip('零〇一二两三四五六七八九', '001223456789'))


def integer_value(text):
    """Read integer notation only; retain unequal numbers as unequal tokens."""
    if not text:
        return 0
    for unit, scale in [('亿', 100000000), ('万', 10000)]:
        if unit in text:
            left, right = text.split(unit, 1)
            return (integer_value(left) if left else 1) * scale + integer_value(right)
    if not any(c in text for c in '十百千'):
        return int(''.join(DIGITS.get(c, c) for c in text))
    total, digits = 0, ''
    for char in text:
        if char in '十百千':
            total += (int(digits) if digits else 1) * {'十':10, '百':100, '千':1000}[char]
            digits = ''
        else:
            digits += DIGITS.get(char, char)
    return total + (int(digits) if digits else 0)


def comparison_units(text):
    """Keep character ranges so number tokens can share their measured interval."""
    result, cursor = [], 0
    for match in NUMBER.finditer(text):
        result.extend((c, i, i+1) for i, c in enumerate(text[cursor:match.start()], cursor))
        result.append((('integer', integer_value(match.group())), match.start(), match.end()))
        cursor = match.end()
    result.extend((c, i, i+1) for i, c in enumerate(text[cursor:], cursor))
    return result


@lru_cache(maxsize=1)
def _icu():
    lib = ctypes.CDLL('/usr/lib/libicucore.A.dylib')
    uchar = ctypes.POINTER(ctypes.c_uint16)
    integer = ctypes.POINTER(ctypes.c_int32)
    lib.utrans_openU.argtypes = [uchar, ctypes.c_int32, ctypes.c_int, uchar,
                                ctypes.c_int32, ctypes.c_void_p, integer]
    lib.utrans_openU.restype = ctypes.c_void_p
    lib.utrans_transUChars.argtypes = [ctypes.c_void_p, uchar, integer,
                                     ctypes.c_int32, ctypes.c_int32, integer, integer]
    lib.utrans_close.argtypes = [ctypes.c_void_p]
    return lib


def simplified(text):
    if not text:
        return text
    lib = _icu()
    transform = 'Traditional-Simplified'.encode('utf-16-le')
    identifier = (ctypes.c_uint16 * (len(transform) // 2)).from_buffer_copy(transform)
    status = ctypes.c_int32(0)
    converter = lib.utrans_openU(identifier, len(identifier), 0, None, 0, None,
                                ctypes.byref(status))
    if status.value > 0 or not converter:
        raise RuntimeError('字幕简繁转换初始化失败，已暂停后续制作')
    try:
        raw = text.encode('utf-16-le')
        length = ctypes.c_int32(len(raw) // 2)
        capacity = max(length.value * 2 + 16, 32)
        buffer = (ctypes.c_uint16 * capacity)()
        ctypes.memmove(buffer, raw, len(raw))
        limit = ctypes.c_int32(length.value)
        lib.utrans_transUChars(converter, buffer, ctypes.byref(length), capacity,
                              0, ctypes.byref(limit), ctypes.byref(status))
        if status.value > 0:
            raise RuntimeError('字幕简繁转换失败，已暂停后续制作')
        result = ctypes.string_at(buffer, length.value * 2).decode('utf-16-le')
        # Every recognized character must retain its measured timestamp.
        if len(result) != len(text):
            raise RuntimeError('字幕简繁转换改变字数，需复核时间对齐')
        return result
    finally:
        lib.utrans_close(converter)
