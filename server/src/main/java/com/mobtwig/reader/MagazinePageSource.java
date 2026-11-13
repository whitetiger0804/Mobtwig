package com.mobtwig.reader;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Arrays;
import java.util.Locale;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** DB에 등록된 비공개 디렉터리의 호 기준 PNG 한 쪽을 제한된 크기로 읽습니다. */
@Component
public class MagazinePageSource {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final String PREFIX = "/content/magazine/";
    private static final byte[] SIGNATURE = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    private static final int IHDR = 0x49484452;
    private static final int IDAT = 0x49444154;
    private static final int IEND = 0x49454e44;
    private final Path root;

    public MagazinePageSource(@Value("${mobtwig.reader.content-root:./content}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    byte[] read(String directory, int page) {
        if (directory == null || !directory.startsWith(PREFIX) || !directory.endsWith("/")
                || directory.length() <= PREFIX.length() || page < 1) throw unavailable();
        String[] parts = directory.substring(PREFIX.length(), directory.length() - 1).split("/", -1);
        for (String part : parts) {
            if (!part.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
                    || part.toUpperCase(Locale.ROOT).matches("CON|AUX|NUL|PRN|COM[0-9]|LPT[0-9]")) throw unavailable();
        }
        try {
            Path base = root.toRealPath();
            Path cursor = base.resolve("magazine");
            checkPath(base, cursor, true);
            for (String part : parts) {
                cursor = cursor.resolve(part);
                checkPath(base, cursor, true);
            }
            Path file = cursor.resolve(page + ".png");
            checkPath(base, file, false);
            byte[] bytes;
            try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
                bytes = input.readNBytes(MAX_BYTES + 1);
            }
            if (bytes.length > MAX_BYTES || !validChunks(bytes)) throw unavailable();
            try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var reader = ImageIO.getImageReadersByFormatName("PNG").next();
                try {
                    reader.setInput(input, true, true);
                    if (reader.read(0) == null) throw unavailable();
                } finally {
                    reader.dispose();
                }
            }
            return bytes;
        } catch (IOException | RuntimeException failure) {
            throw unavailable();
        }
    }

    private static void checkPath(Path base, Path cursor, boolean directory) throws IOException {
        var attrs = Files.readAttributes(cursor, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        Path real = cursor.toRealPath();
        if (!real.startsWith(base) || !real.equals(cursor) || attrs.isSymbolicLink() || attrs.isOther()
                || (directory ? !attrs.isDirectory() : !attrs.isRegularFile())) throw unavailable();
    }

    private static boolean validChunks(byte[] bytes) {
        if (bytes.length < 45 || !Arrays.equals(bytes, 0, 8, SIGNATURE, 0, 8)) return false;
        var buffer = ByteBuffer.wrap(bytes);
        buffer.position(8);
        boolean header = false;
        boolean image = false;
        var crc = new CRC32();
        while (buffer.remaining() >= 12) {
            int length = buffer.getInt();
            int typeStart = buffer.position();
            int type = buffer.getInt();
            if (length < 0 || length > buffer.remaining() - 4) return false;
            if (!header) {
                if (type != IHDR || length != 13) return false;
                int width = buffer.getInt(buffer.position());
                int height = buffer.getInt(buffer.position() + 4);
                if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long) width * height > 8_000_000) return false;
                header = true;
            } else if (type == IHDR) {
                return false;
            }
            if (type == IDAT && length > 0) image = true;
            crc.reset();
            crc.update(bytes, typeStart, 4 + length);
            buffer.position(buffer.position() + length);
            if (buffer.getInt() != (int) crc.getValue()) return false;
            if (type == IEND) return length == 0 && image && !buffer.hasRemaining();
        }
        return false;
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "매거진 쪽을 제공할 수 없습니다.");
    }
}
