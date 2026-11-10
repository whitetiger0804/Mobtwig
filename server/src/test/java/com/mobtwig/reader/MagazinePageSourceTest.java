package com.mobtwig.reader;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class MagazinePageSourceTest {
    @TempDir Path workspace;

    @Test void acceptsPngAndRejectsCorruptionOversizeAndPaths() throws Exception {
        Path root = workspace.resolve("content");
        Path article = Files.createDirectories(root.resolve("magazine/issue-a/article"));
        Path image = article.resolve("6.png");
        writePng(image, 8, 12);
        var source = new MagazinePageSource(root.toString());
        String url = "/content/magazine/issue-a/article/";
        byte[] good = Files.readAllBytes(image);
        assertArrayEquals(good, source.read(url, 6));
        for (String bad : new String[]{"/content/magazine/issue-a/../", "/content/magazine/%2e%2e/", "/content/magazine/",
                "/content/magazine/issue-a//article/", "/content/magazine/issue-a/CON/", "/content/magazine/issue-a/article:stream/",
                "/content/magazine/issue-a/article.pdf", "https://example.test/images/"}) {
            reject(source, bad, 6);
        }
        reject(source, url, 7);
        byte[] corrupt = good.clone();
        corrupt[29] ^= 1;
        Files.write(image, corrupt);
        reject(source, url, 6);
        Files.write(image, java.util.Arrays.copyOf(good, good.length - 3));
        reject(source, url, 6);
        writePng(image, 4097, 1);
        reject(source, url, 6);
        Files.write(image, new byte[MagazinePageSource.MAX_BYTES + 1]);
        reject(source, url, 6);
    }

    @Test void deniesSymlinkForBothDirectoryAndFile() throws Exception {
        Path root = Files.createDirectories(workspace.resolve("content/magazine"));
        Path elsewhere = Files.createDirectory(workspace.resolve("outside"));
        Path png = elsewhere.resolve("6.png");
        writePng(png, 8, 12);
        Path internal = Files.createDirectory(root.resolve("inside"));
        try {
            Files.createSymbolicLink(root.resolve("outside-link"), elsewhere);
            Files.createSymbolicLink(internal.resolve("6.png"), png);
        } catch (IOException | UnsupportedOperationException | SecurityException failure) {
            assumeTrue(false, "심볼릭 링크를 만들 수 없는 환경입니다.");
        }
        var source = new MagazinePageSource(root.getParent().toString());
        reject(source, "/content/magazine/outside-link/", 6);
        reject(source, "/content/magazine/inside/", 6);
    }

    @Test @EnabledOnOs(OS.WINDOWS)
    void deniesWindowsJunctionEvenIfItTargetsInsideTheContentRoot() throws Exception {
        Path root = Files.createDirectories(workspace.resolve("content/magazine"));
        Path real = Files.createDirectory(root.resolve("real"));
        writePng(real.resolve("6.png"), 8, 12);
        Path link = root.resolve("junction");
        var create = new ProcessBuilder("cmd.exe", "/d", "/c", "mklink", "/J", link.toString(), real.toString())
                .redirectErrorStream(true).start();
        try {
            assumeTrue(create.waitFor(10, java.util.concurrent.TimeUnit.SECONDS) && create.exitValue() == 0, "정션을 만들 수 없는 환경입니다.");
            reject(new MagazinePageSource(root.getParent().toString()), "/content/magazine/junction/", 6);
        } finally {
            if (create.isAlive()) create.destroyForcibly();
            Files.deleteIfExists(link);
        }
    }

    private void reject(MagazinePageSource source, String directory, int page) {
        var failure = assertThrows(ResponseStatusException.class, () -> source.read(directory, page));
        assertEquals(503, failure.getStatusCode().value());
        assertFalse(failure.getMessage().contains(workspace.toString()));
    }

    private void writePng(Path image, int width, int height) throws IOException {
        assertTrue(ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "PNG", image.toFile()));
    }
}
