package com.mobtwig.reader;

import java.util.ArrayList;
import java.util.List;
import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 비공개 기사를 포함한 범위를 먼저 계산해 공개 기사로 넘어가는 쪽을 막습니다. */
final class MagazineLayout {
    private MagazineLayout() { }

    static List<Range> ranges(Work work) {
        var ranges = new ArrayList<Range>();
        int last = 0;
        for (Chapter chapter : work.chapters()) {
            Integer start = chapter.startPage();
            if (start == null || start <= last || work.pageCount() != null && start > work.pageCount()) throw unavailable();
            if (!ranges.isEmpty()) {
                var previous = ranges.getLast();
                ranges.set(ranges.size() - 1, new Range(previous.chapter(), previous.start(), start - 1));
            }
            ranges.add(new Range(chapter, start, work.pageCount()));
            last = start;
        }
        return ranges;
    }

    static Range range(Work work, Chapter chapter) {
        return ranges(work).stream().filter(range -> range.chapter().id() == chapter.id()).findFirst()
                .orElseThrow(MagazineLayout::unavailable);
    }

    static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "매거진 쪽 범위를 확인할 수 없습니다.");
    }

    record Range(Chapter chapter, int start, Integer end) {
        boolean contains(int page) { return page >= start && (end == null || page <= end); }
    }
}
