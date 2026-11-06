package com.mobtwig.reader;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.jspecify.annotations.Nullable;

/** 실제 표시 텍스트와 동일한 공개 스냅샷의 목차·이웃입니다. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ChapterTextResponse(String workId, String workTitle, String kind,
        ChapterRef chapter, List<ChapterRef> contents, int currentIndex,
        @Nullable ChapterRef previous, @Nullable ChapterRef next,
        String body, int characterCount, int contentVersion, String contentHash) {
    /** 회차 번호가 비연속적이어도 ID와 공개 목차의 순서로 이동합니다. */
    public record ChapterRef(String id, String title, int number) { }
}
