package com.mobtwig.reader;

import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.stereotype.Component;

/** 표시 원문과 공개 기사 범위에서 좌표를 검증합니다. */
@Component
class ReadingCoordinates {
    private final PlainTextSource source;

    ReadingCoordinates(PlainTextSource source) {
        this.source = source;
    }

    Checked verify(Work work, Chapter chapter, int offset, int version, String hash) {
        if (chapter.version() != version) throw ReadingProgressFailure.contentChanged();
        if (work.magazine()) {
            if (hash != null) throw ReadingProgressFailure.invalid();
            var pages = MagazineLayout.range(work, chapter);
            if (!pages.contains(offset)) throw ReadingProgressFailure.invalid();
            return new Checked(chapter, offset, pages.start(), pages.end(), null, null);
        }
        if (hash == null) throw ReadingProgressFailure.invalid();
        var text = source.read(chapter.url());
        if (!hash.equals(text.version())) throw ReadingProgressFailure.contentChanged();
        if (offset < 0 || offset > text.characterCount() || splitsPair(text.body(), offset)) {
            throw ReadingProgressFailure.invalid();
        }
        return new Checked(chapter, offset, 0, text.characterCount(), text.version(), text.body());
    }

    static boolean splitsPair(String body, int offset) {
        return offset > 0 && offset < body.length()
                && Character.isHighSurrogate(body.charAt(offset - 1)) && Character.isLowSurrogate(body.charAt(offset));
    }

    record Checked(Chapter chapter, int offset, int start, Integer end, String hash, String body) { }
}
