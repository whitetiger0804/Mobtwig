package com.mobtwig.reader;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** 관리자가 지정한 비공개 폴더만 읽습니다. URL 네트워크 공급자는 없습니다. */
@Component
public class PlainTextSource {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    private final Path root;

    public PlainTextSource(@Value("${mobtwig.reader.content-root:./content}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    /** 허용된 일반 파일 하나를 제한 크기로 읽고 표시 텍스트를 한 번 정규화합니다. */
    public Text read(String source) {
        if (source == null || !source.startsWith("/content/") || !source.endsWith(".txt")
                || source.indexOf('\\') >= 0 || source.indexOf('%') >= 0
                || source.indexOf('?') >= 0 || source.indexOf('#') >= 0
                || source.chars().anyMatch(c -> c < 32)) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 본문 형식입니다.");
        }
        String relative = source.substring("/content/".length());
        for (String part : relative.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.contains(":")) throw unavailable();
        }
        try {
            Path base = root.toRealPath();
            Path file = base.resolve(relative).normalize();
            if (!file.startsWith(base)) throw unavailable();
            Path cursor = base;
            for (Path part : base.relativize(file)) {
                cursor = cursor.resolve(part);
                if (Files.isSymbolicLink(cursor)) throw unavailable();
            }
            Path real = file.toRealPath();
            if (!real.startsWith(base) || !Files.isRegularFile(real, LinkOption.NOFOLLOW_LINKS)) throw unavailable();
            byte[] bytes;
            try (var input = Files.newInputStream(real, LinkOption.NOFOLLOW_LINKS)) {
                bytes = input.readNBytes(MAX_BYTES + 1);
            }
            if (bytes.length > MAX_BYTES) throw unavailable();
            String body = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
            if (body.startsWith("\uFEFF")) body = body.substring(1);
            body = body.replace("\r\n", "\n").replace('\r', '\n');
            if (body.indexOf('\0') >= 0) throw unavailable();
            String version = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8)));
            return new Text(body, body.length(), version);
        } catch (IOException | IllegalArgumentException | SecurityException exception) {
            throw unavailable();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.");
        }
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "본문을 제공할 수 없습니다. 다시 시도해 주십시오.");
    }

    /** 길이·버전은 동일한 정규화 결과에서 계산합니다. */
    public record Text(String body, int characterCount, String version) { }
}
