package com.mobtwig.reader;

import java.time.Instant;
import java.util.Objects;

import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Saved;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원의 위치·서재 상태를 일관된 공개 회차 기준으로 처리합니다. */
@Service
public class ReadingProgressService {
    private final ReadingProgressRepository repository;
    private final PlainTextSource source;

    public ReadingProgressService(ReadingProgressRepository repository, PlainTextSource source) {
        this.repository = repository;
        this.source = source;
    }

    @Transactional(readOnly = true)
    public ReadingProgressResponse read(long member, String slug) {
        Work work = work(slug, Instant.now(), false);
        Saved saved = repository.saved(member, work.id()).orElse(null);
        String library = repository.libraryStatus(member, work.id());
        Chapter first = work.visible().stream().findFirst().orElse(null);
        if (saved == null) return response(work, "new", null, start(work, first), library);
        Chapter chapter = work.visible().stream().filter(c -> c.id() == saved.chapter()).findFirst().orElse(null);
        if (chapter != null) {
            try {
                var checked = verify(work, chapter, saved.offset(), saved.version(), saved.hash());
                return response(work, "saved", saved, checked, library);
            } catch (ResponseStatusException unavailable) {
                // 구버전·불일치·일시적 본문 부재에서는 기존 저장값을 유지합니다.
            }
        }
        var fallback = start(work, chapter);
        if (fallback == null && !Objects.equals(first, chapter)) fallback = start(work, first);
        return response(work, "stale", saved, fallback, library);
    }

    @Transactional
    public ReadingProgressResponse save(long member, String slug, Input input) {
        // 회원 행을 먼저 잠가 최초 저장과 기존 기록의 모든 writer를 같은 순서로 직렬화합니다.
        if (!repository.lockActiveMember(member)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Instant now = Instant.now();
        Work work = work(slug, now, true);
        Chapter chapter = work.visible().stream().filter(c -> c.id() == input.chapterId()).findFirst()
                .orElseThrow(ReadingProgressFailure::notFound);
        Saved previous = repository.saved(member, work.id()).orElse(null);
        Long currentRevision = previous == null ? null : previous.revision();
        if (!Objects.equals(currentRevision, input.expectedRevision())) throw ReadingProgressFailure.conflict();
        var checked = verify(work, chapter, input.offset(), input.contentVersion(), input.contentHash());

        var previousMax = previous == null ? null : maxChapter(work, previous);
        long max = previousMax != null && previousMax.number() > chapter.number() ? previousMax.id() : chapter.id();
        long revision = previous == null ? 1 : Math.addExact(previous.revision(), 1);
        var next = new Saved(chapter.id(), input.offset(), max, chapter.version(), checked.hash(), revision, now);
        String library = completed(work, checked) ? "COMPLETED" : "READING";
        repository.store(member, work.id(), next, previous != null);
        repository.storeLibrary(member, work.id(), library);
        return response(work, "saved", repository.saved(member, work.id()).orElseThrow(), checked, library);
    }

    private Work work(String slug, Instant now, boolean writing) {
        if (slug == null || slug.length() > 120 || !slug.matches("[a-z0-9-]+")) throw ReadingProgressFailure.invalid();
        return repository.work(slug, now, writing).orElseThrow(ReadingProgressFailure::notFound);
    }

    private Checked verify(Work work, Chapter chapter, int offset, int version, String hash) {
        if (chapter.version() != version) throw ReadingProgressFailure.contentChanged();
        if (work.magazine()) {
            if (hash != null) throw ReadingProgressFailure.invalid();
            var pages = MagazineLayout.range(work, chapter);
            if (!pages.contains(offset)) throw ReadingProgressFailure.invalid();
            return new Checked(chapter, offset, pages.start(), pages.end(), null);
        }
        if (hash == null) throw ReadingProgressFailure.invalid();
        var text = source.read(chapter.url());
        if (!hash.equals(text.version())) throw ReadingProgressFailure.contentChanged();
        if (offset < 0 || offset > text.characterCount()
                || offset > 0 && offset < text.characterCount()
                && Character.isHighSurrogate(text.body().charAt(offset - 1)) && Character.isLowSurrogate(text.body().charAt(offset))) {
            throw ReadingProgressFailure.invalid();
        }
        return new Checked(chapter, offset, 0, text.characterCount(), text.version());
    }

    private Checked start(Work work, Chapter chapter) {
        if (chapter == null) return null;
        try {
            if (work.magazine()) {
                var pages = MagazineLayout.range(work, chapter);
                return new Checked(chapter, pages.start(), pages.start(), pages.end(), null);
            }
            var text = source.read(chapter.url());
            return new Checked(chapter, 0, 0, text.characterCount(), text.version());
        } catch (ResponseStatusException unavailable) {
            return null;
        }
    }

    private boolean completed(Work work, Checked position) {
        if (position.chapter().id() != work.visible().getLast().id() || position.end() == null) return false;
        if (work.magazine()) return Objects.equals(work.pageCount(), position.offset()) && position.offset() == position.end();
        return position.end() > 0 && position.offset() == position.end();
    }

    private ReadingProgressResponse response(Work work, String state, Saved saved, Checked checked, String library) {
        var max = saved == null ? null : maxChapter(work, saved);
        String publicMax = max == null || !max.visible() ? null : Long.toString(max.id());
        boolean newChapters = "COMPLETED".equals(library) && max != null && work.visible().stream().anyMatch(c -> c.number() > max.number());
        var position = checked == null ? null : new ReadingProgressResponse.Position(Long.toString(checked.chapter().id()),
                checked.offset(), work.magazine() ? "page" : "utf16", checked.chapter().version(), checked.hash());
        boolean valid = "saved".equals(state) && checked != null;
        return new ReadingProgressResponse(work.slug(), work.kind(), state, position,
                saved == null ? null : Long.toString(saved.revision()), saved == null ? null : saved.lastReadAt().toString(),
                valid ? chapterPercent(work, checked) : null, valid ? workPercent(work, checked) : null, publicMax, library, newChapters);
    }

    private Chapter maxChapter(Work work, Saved saved) {
        long max = saved.maxChapter() == null ? saved.chapter() : saved.maxChapter();
        return work.chapters().stream().filter(c -> c.id() == max).findFirst().orElse(null);
    }

    private Double chapterPercent(Work work, Checked position) {
        if (position.end() == null) return null;
        return work.magazine() ? percent(position.offset() - position.start() + 1L, position.end() - position.start() + 1L)
                : percent(position.offset(), position.end());
    }

    private Double workPercent(Work work, Checked position) {
        if (work.magazine()) return work.pageCount() == null ? null : percent(position.offset(), work.pageCount());
        var visible = work.visible();
        if (visible.size() > 64) return null;
        long total = 0;
        long reached = position.offset();
        try {
            for (var chapter : visible) {
                int length = chapter.id() == position.chapter().id() ? position.end() : source.read(chapter.url()).characterCount();
                total += length;
                if (total > 2_000_000) return null;
                if (chapter.number() < position.chapter().number()) reached += length;
            }
        } catch (ResponseStatusException unavailable) {
            return null;
        }
        return percent(reached, total);
    }

    private static Double percent(long value, long total) {
        return total <= 0 ? null : Math.round(value * 10_000.0 / total) / 100.0;
    }

    /** 쓰기 요청은 소유자와 진행률을 받지 않습니다. */
    public record Input(long chapterId, int offset, int contentVersion, String contentHash, Long expectedRevision) { }
    private record Checked(Chapter chapter, int offset, int start, Integer end, String hash) { }
}
