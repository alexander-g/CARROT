import typing as tp

#chatgpt
def get_jpg_size(path:str) -> tp.Tuple[int,int]|ValueError:
    with open(path, 'rb') as f:
        # Read the first two bytes to check for JPEG signature
        if f.read(2) != b'\xff\xd8':
            return ValueError("Not a valid JPEG file")
        
        # Read through the file to find the size
        while True:
            marker = f.read(2)
            if marker[0] != 0xff:
                return ValueError("Invalid JPEG format")
            if marker[1] == 0xc0 or marker[1] == 0xc2:  # Start of Frame markers
                f.read(3)  # Skip length and precision
                height = int.from_bytes(f.read(2), 'big')
                width = int.from_bytes(f.read(2), 'big')
                return (width, height)
            else:
                # Read the length of the segment
                length = int.from_bytes(f.read(2), 'big')
                f.seek(length - 2, 1)  # Move to the next segment


def get_png_size(path:str) -> tp.Tuple[int,int]|ValueError:
    with open(path, 'rb') as f:
        # Read the PNG signature
        if f.read(8) != b'\x89PNG\r\n\x1a\n':
            return ValueError("Not a valid PNG file")
        
        while True:
            # Read the length of the chunk
            length_bytes = f.read(4)
            if len(length_bytes) < 4:
                return ValueError("Invalid PNG format")
            length = int.from_bytes(length_bytes, 'big')
            
            # Read the chunk type
            chunk_type = f.read(4)
            if chunk_type == b'IHDR':
                # Read width and height
                width = int.from_bytes(f.read(4), 'big')
                height = int.from_bytes(f.read(4), 'big')
                return (width, height)
            else:
                # Skip the chunk data and CRC
                f.seek(length + 4, 1)  # Skip data and CRC


def get_tiff_size(file_path):
    with open(file_path, 'rb') as f:
        # Read the first 4 bytes to check for TIFF signature
        byte_order = f.read(2)
        if byte_order not in [b'II', b'MM']:
            return ValueError("Not a valid TIFF file")
        
        # Determine byte order
        endian = 'little' if byte_order == b'II' else 'big'
        
        # Read the next 2 bytes (TIFF version)
        version = int.from_bytes(f.read(2), endian)
        if version not in [42, 43]:  # 42 for TIFF, 43 for BigTIFF
            return ValueError("Not a valid TIFF file")
        
        big_tiff = (version == 43)
        
        # Read the offset to the first IFD
        if not big_tiff:
            ifd_offset = int.from_bytes(f.read(4), endian)
        else:
            # if it's BigTIFF, there should be an extra 4 bytes
            f.read(4)
            # the offset is 8 bytes
            ifd_offset = int.from_bytes(f.read(8), endian)
        
        f.seek(ifd_offset)
        
        # Read the number of entries in the IFD
        num_entries = int.from_bytes(f.read(2 if not big_tiff else 8), endian)
        
        width = height = None
        
        for _ in range(num_entries):
            tag = int.from_bytes(f.read(2), endian)
            field_type = int.from_bytes(f.read(2), endian)
            count = int.from_bytes(f.read(4 if not big_tiff else 8), endian)
            value_offset = \
                int.from_bytes(f.read(4 if not big_tiff else 8), endian)
            
            # Check for width (tag 256) and height (tag 257)
            if tag == 256:  # ImageWidth
                if count == 1:
                    width = value_offset
                else:
                    f.seek(value_offset)  # Seek to the value offset
                    width = \
                        int.from_bytes(f.read(4 if not big_tiff else 8), endian)
            elif tag == 257:  # ImageLength
                if count == 1:
                    height = value_offset
                else:
                    f.seek(value_offset)  # Seek to the value offset
                    height = \
                        int.from_bytes(f.read(4 if not big_tiff else 8), endian)
        
        if None in [width, height]:
            return ValueError('Image size not found')
        
        return (width, height)
