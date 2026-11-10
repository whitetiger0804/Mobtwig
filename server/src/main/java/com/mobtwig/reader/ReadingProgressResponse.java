package com.mobtwig.reader;

/** 동일한 공개 본문 스냅샷에서 계산한 읽기 위치와 진행률입니다. */
public record ReadingProgressResponse(String workId, String kind, String state, Position position,
        String revision, String lastReadAt, Double chapterPercent, Double workPercent, String maxChapterId,
        String libraryStatus, boolean hasNewChapters) {

    /** offset의 단위는 콘텐츠 종류가 결정합니다. */
    public record Position(String chapterId, int offset, String unit, int contentVersion, String contentHash) { }
}
