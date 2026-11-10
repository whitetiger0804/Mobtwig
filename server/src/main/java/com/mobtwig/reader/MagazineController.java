package com.mobtwig.reader;

import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 공개 쪽 목록과 PNG를 같은 기사 공개 규칙으로 제공합니다. */
@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/works/{slug}/magazine")
public class MagazineController {
    private final MagazineService magazine;

    public MagazineController(MagazineService magazine) { this.magazine = magazine; }

    @GetMapping
    public ResponseEntity<MagazineService.Issue> read(@PathVariable String slug) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(magazine.read(slug));
    }

    @GetMapping("/pages/{pageNumber}")
    public ResponseEntity<byte[]> page(@PathVariable String slug, @PathVariable String pageNumber, HttpServletRequest request) {
        String[] versions = request.getParameterValues("contentVersion");
        if (versions == null || versions.length != 1) throw MagazineService.invalid();
        byte[] png = magazine.page(slug, positive(pageNumber), positive(versions[0]));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(png);
    }

    private static int positive(String value) {
        if (!value.matches("[1-9][0-9]{0,9}")) throw MagazineService.invalid();
        try { return Integer.parseInt(value); }
        catch (NumberFormatException invalid) { throw MagazineService.invalid(); }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", failure.getReason() == null ? "매거진을 제공할 수 없습니다." : failure.getReason()));
    }
}
