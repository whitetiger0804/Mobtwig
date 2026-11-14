package com.mobtwig.reader;

import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.stereotype.Component;

/** 표시 원문과 공개 기사 범위에서 좌표를 검증합니다. */
@Component
class ReadingCoordinates {
    private final PlainTextSource source;
    private final TextVersionRegistry versions;

    ReadingCoordinates(PlainTextSource source, TextVersionRegistry versions) {
        this.source = source;
        this.versions = versions;
    }

    Checked verify(Work work, Chapter chapter, int offset, int version, String hash) {
        if (!work.magazine() && hash == null) throw ReadingProgressFailure.invalid();
        return compare(work, chapter, offset, version, hash, false, false);
    }

    Checked verifyPosition(Work work, Chapter chapter, int offset, int version, String hash, boolean bound, boolean writing) {
        if (!work.magazine() && hash == null && !bound && !writing) throw ReadingProgressFailure.invalid();
        return compare(work, chapter, offset, version, hash, true, writing);
    }

    private Checked compare(Work work, Chapter chapter, int offset, int version, String hash, boolean position, boolean writing) {
        if (chapter.version() != version) throw ReadingProgressFailure.contentChanged();
        if (work.magazine()) {
            if (hash != null) throw ReadingProgressFailure.invalid();
            var pages = MagazineLayout.range(work, chapter);
            if (!pages.contains(offset)) throw ReadingProgressFailure.invalid();
            return new Checked(chapter, offset, pages.start(), pages.end(), null, null);
        }
        var text = source.read(chapter.url());
        if (hash != null && !hash.equals(text.version())) throw ReadingProgressFailure.contentChanged();
        if (position) versions.verify(chapter.id(), version, text.version(), hash == null);
        if (offset < 0 || offset > text.characterCount() || splitsPair(text.body(), offset)) {
            throw ReadingProgressFailure.invalid();
        }
        if (position && writing && hash != null) versions.pin(chapter.id(), version, text.version());
        return new Checked(chapter, offset, 0, text.characterCount(), text.version(), text.body());
    }

    static boolean splitsPair(String body, int offset) {
        return offset > 0 && offset < body.length()
                && Character.isHighSurrogate(body.charAt(offset - 1)) && Character.isLowSurrogate(body.charAt(offset));
    }

    record Checked(Chapter chapter, int offset, int start, Integer end, String hash, String body) { }
}
