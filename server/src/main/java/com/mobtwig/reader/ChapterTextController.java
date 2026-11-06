package com.mobtwig.reader;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 공개 텍스트 API입니다. 비공개 파일 자체를 정적 경로로 노출하지 않습니다. */
@RestController
@CrossOrigin(origins = "*")
public class ChapterTextController {
    private final ChapterTextService reader;
    public ChapterTextController(ChapterTextService reader) { this.reader = reader; }

    @GetMapping("/works/{slug}/chapters/{chapterId}")
    public ResponseEntity<ChapterTextResponse> read(@PathVariable String slug, @PathVariable String chapterId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(reader.read(slug, chapterId));
    }
}
