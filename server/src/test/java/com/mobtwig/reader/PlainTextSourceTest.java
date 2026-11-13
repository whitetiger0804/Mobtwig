package com.mobtwig.reader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class PlainTextSourceTest {
    @TempDir Path directory;

    @Test void normalizesOnlyEncodingMarkersAndLineEndings() throws Exception {
        Files.writeString(directory.resolve("one.txt"), "\uFEFF  가🌱\r\n\r둘째\n[[term|표시]] <b>문자</b>  ", StandardCharsets.UTF_8);
        var result = new PlainTextSource(directory.toString()).read("/content/one.txt");
        assertEquals("  가🌱\n\n둘째\n[[term|표시]] <b>문자</b>  ", result.body());
        assertEquals(result.body().length(), result.characterCount());
        Files.writeString(directory.resolve("same.txt"), result.body(), StandardCharsets.UTF_8);
        assertEquals(result.version(), new PlainTextSource(directory.toString()).read("/content/same.txt").version());
        assertTrue(result.version().matches("[a-f0-9]{64}"));
        Files.writeString(directory.resolve("empty.txt"), "");
        assertEquals(0, new PlainTextSource(directory.toString()).read("/content/empty.txt").characterCount());
    }

    @Test void refusesExternalAndNonTextSourcesWithoutFollowingThem() {
        var source = new PlainTextSource(directory.toString());
        for (String value : new String[]{"https://127.0.0.1/private.txt", "http://169.254.169.254/metadata", "file:///secret.txt", "/content/a.html", "/content/a.epub", "//host/a.txt", "/content/a%2Fsecret.txt"}) {
            assertEquals(415, assertThrows(ResponseStatusException.class, () -> source.read(value)).getStatusCode().value());
        }
    }

    @Test void boundsFilesAndRejectsEscapesMalformedUtf8AndMissingFiles() throws Exception {
        var source = new PlainTextSource(directory.toString());
        Files.write(directory.resolve("bad.txt"), new byte[]{(byte)0xc3, 0x28});
        Files.write(directory.resolve("big.txt"), new byte[PlainTextSource.MAX_BYTES + 1]);
        Files.createDirectory(directory.resolve("folder.txt"));
        for (String value : new String[]{"/content/../secret.txt", "/content/a/../../secret.txt", "/content/bad.txt", "/content/big.txt", "/content/missing.txt", "/content/folder.txt", "/content/C:/secret.txt", "/content//a.txt"}) {
            var error = assertThrows(ResponseStatusException.class, () -> source.read(value), value);
            assertEquals(503, error.getStatusCode().value(), value);
            assertFalse(error.getReason().contains(directory.toString()));
        }
    }

    @Test void acceptsExactByteLimitAndUnicodeFileNames() throws Exception {
        Files.writeString(directory.resolve("한글.txt"), "a".repeat(PlainTextSource.MAX_BYTES));
        assertEquals(PlainTextSource.MAX_BYTES, new PlainTextSource(directory.toString()).read("/content/한글.txt").characterCount());
    }

    @Test void refusesSymbolicLinksWhenThePlatformCanCreateThem() throws Exception {
        Path target = directory.resolve("original.txt");
        Files.writeString(target, "비공개 원문");
        try { Files.createSymbolicLink(directory.resolve("link.txt"), target); }
        catch (java.io.IOException | UnsupportedOperationException | SecurityException e) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false, "플랫폼에 심볼릭 링크 생성 권한이 없습니다.");
        }
        assertEquals(503, assertThrows(ResponseStatusException.class,
                () -> new PlainTextSource(directory.toString()).read("/content/link.txt")).getStatusCode().value());
    }
}
