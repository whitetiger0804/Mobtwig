package com.mobtwig.community;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 이미지의 실제 형식·크기와 파일 소유자를 확인하며 정적 공개 폴더 밖에 보관합니다. */
@Component
class CommunityImages {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Pattern FILE = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png");
    static final Pattern URL = Pattern.compile("(?:/api/members)?/community/images/(-?[1-9][0-9]{0,18})/"
            + "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png)(?:\\?reveal=true)?");
    private final Path root;

    CommunityImages(@Value("${mobtwig.community.image-root:./community-images}") String location) {
        root = Path.of(location).toAbsolutePath().normalize();
    }

    /** 클라이언트가 축소한 PNG·JPEG를 다시 PNG로 인코딩해 부가 메타데이터를 제거합니다. */
    CommunityService.ImageInput upload(long owner, String base64, String mime) throws IOException {
        if (!mime.equals("image/png") && !mime.equals("image/jpeg")) throw invalid();
        if (base64.isEmpty() || base64.length() > ((MAX_BYTES + 2) / 3) * 4) throw invalid();
        byte[] input;
        try { input = Base64.getDecoder().decode(base64); }
        catch (IllegalArgumentException failure) { throw invalid(); }
        if (input.length > MAX_BYTES) throw invalid();
        BufferedImage decoded;
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(input))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw invalid();
            ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                String actual = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!(mime.equals("image/png") && actual.equals("png") || mime.equals("image/jpeg") && actual.equals("jpeg")))
                    throw invalid();
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 1024 || height > 1024) throw invalid();
                decoded = reader.read(0);
            } finally { reader.dispose(); }
        } catch (IOException failure) { throw invalid(); }
        var output = new ByteArrayOutputStream();
        if (!ImageIO.write(decoded, "png", output)) throw invalid();
        byte[] png = output.toByteArray();
        if (png.length > MAX_BYTES) throw invalid();
        String name = UUID.randomUUID() + ".png";
        Path destination = file(owner, name);
        Files.createDirectories(destination.getParent());
        ensureContained(destination.getParent());
        Files.write(destination, png, StandardOpenOption.CREATE_NEW);
        return new CommunityService.ImageInput("/api/members" + canonical(owner, name), decoded.getWidth(), decoded.getHeight());
    }

    /** 본인이 업로드한 실제 파일과 입력된 치수가 일치할 때만 첨부를 허용합니다. */
    String validate(long owner, CommunityService.ImageInput input) throws IOException {
        var match = URL.matcher(input.url());
        if (!match.matches() || !match.group(1).equals(Long.toString(owner))) throw invalid();
        Path path = existing(owner, match.group(2));
        try (var stream = ImageIO.createImageInputStream(path.toFile())) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw invalid();
            var reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                if (reader.getWidth(0) != input.width() || reader.getHeight(0) != input.height()) throw invalid();
            } finally { reader.dispose(); }
        }
        return canonical(owner, match.group(2));
    }

    boolean isManaged(String url) { return URL.matcher(url).matches(); }

    String displayUrl(String url, boolean privateImage, boolean reveal) {
        var match = URL.matcher(url);
        if (!match.matches()) return url;
        return (privateImage ? "/api/members" : "") + "/community/images/" + match.group(1) + "/" + match.group(2)
                + (reveal ? "?reveal=true" : "");
    }

    String canonical(long owner, String name) {
        if (!FILE.matcher(name).matches()) throw CommunityService.notFound();
        return "/community/images/" + owner + "/" + name;
    }

    byte[] read(long owner, String name) throws IOException { return Files.readAllBytes(existing(owner, name)); }

    private Path existing(long owner, String name) throws IOException {
        Path path = file(owner, name);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw CommunityService.notFound();
        ensureContained(path);
        return path;
    }

    private Path file(long owner, String name) {
        canonical(owner, name);
        return root.resolve(Long.toString(owner)).resolve(name);
    }

    private void ensureContained(Path path) throws IOException {
        if (!path.toRealPath().startsWith(root.toRealPath()) || Files.isSymbolicLink(path.getParent()))
            throw CommunityService.notFound();
    }

    private static org.springframework.web.server.ResponseStatusException invalid() {
        return CommunityService.invalid("이미지는 PNG·JPEG 형식, 2MB 이하, 가로·세로 1024px 이하로 준비해 주세요.");
    }
}
