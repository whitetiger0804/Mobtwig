package com.mobtwig.reader;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import com.mobtwig.reader.BookmarkRepository.Saved;
import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 위치와 본인 책갈피를 검증하며 독서 진도에는 접근하지 않습니다. */
@Service
public class BookmarkService {
    private static final int PAGE_SIZE = 30;
    private final BookmarkRepository bookmarks;
    private final ReadingProgressRepository works;
    private final ReadingCoordinates coordinates;

    BookmarkService(BookmarkRepository bookmarks, ReadingProgressRepository works, ReadingCoordinates coordinates) {
        this.bookmarks = bookmarks;
        this.works = works;
        this.coordinates = coordinates;
    }

    @Transactional(readOnly = true)
    public Page read(long member, String slug, int page) {
        if (slug != null) validateSlug(slug);
        var rows = bookmarks.list(member, slug, (page - 1L) * PAGE_SIZE, PAGE_SIZE + 1);
        var snapshots = new HashMap<String, Optional<Work>>();
        Instant now = Instant.now();
        var items = rows.stream().limit(PAGE_SIZE).map(saved -> {
            var work = snapshots.computeIfAbsent(saved.slug(), key -> works.work(key, now, false)).orElse(null);
            return describe(saved, work);
        }).toList();
        return new Page(items, page, rows.size() > PAGE_SIZE);
    }

    @Transactional
    public Item save(long member, Input input) {
        validateSlug(input.workId());
        lockMember(member);
        Work work = works.work(input.workId(), Instant.now(), true).orElseThrow(ReadingProgressFailure::notFound);
        Chapter chapter = visible(work, input.chapterId()).orElseThrow(ReadingProgressFailure::notFound);
        var position = coordinates.verifyPosition(work, chapter, input.offset(), input.contentVersion(), input.contentHash(), false, true);
        if (position.body() != null && !paragraphBoundary(position.body(), input.offset())) throw ReadingProgressFailure.invalid();
        var existing = bookmarks.byPosition(member, chapter.id(), input.offset());
        if (existing.isPresent()) return describe(existing.get(), work);
        String excerpt = position.body() == null ? null : snippet(position.body(), position.offset());
        return describe(bookmarks.insert(member, work.id(), position, excerpt), work);
    }

    @Transactional
    public void delete(long member, long id) {
        lockMember(member);
        if (!bookmarks.delete(member, id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "책갈피가 없습니다.");
        }
    }

    private Item describe(Saved saved, Work work) {
        var chapter = visible(work, saved.chapter()).orElse(null);
        String id = Long.toString(saved.id());
        String createdAt = saved.createdAt().toString();
        if (chapter == null) return new Item(id, "hidden", null, null, null, null, null, null, createdAt);
        String unit = work.magazine() ? "page" : "utf16";
        try {
            var checked = coordinates.verifyPosition(work, chapter, saved.offset(), saved.version(), saved.hash(), saved.bound(), false);
            var position = new ReadingProgressResponse.Position(Long.toString(chapter.id()), saved.offset(), unit, saved.version(), checked.hash());
            return new Item(id, "available", work.slug(), work.title(), work.kind(), chapter.title(), position,
                    work.magazine() ? null : saved.snippet(), createdAt);
        } catch (ResponseStatusException changed) {
            var position = new ReadingProgressResponse.Position(Long.toString(chapter.id()), saved.offset(), unit, saved.version(), saved.hash());
            return new Item(id, "stale", work.slug(), work.title(), work.kind(), chapter.title(), position, null, createdAt);
        }
    }

    private static Optional<Chapter> visible(Work work, long chapter) {
        if (work == null) return Optional.empty();
        return work.chapters().stream().filter(value -> value.visible() && value.id() == chapter).findFirst();
    }

    private void lockMember(long member) {
        if (!works.lockActiveMember(member)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }

    private static void validateSlug(String slug) {
        if (slug == null || !slug.matches("[a-z0-9-]{1,120}")) throw ReadingProgressFailure.invalid();
    }

    private static boolean paragraphBoundary(String body, int offset) {
        return offset == 0 || offset == body.length()
                || offset >= 2 && body.charAt(offset - 2) == '\n' && body.charAt(offset - 1) == '\n' && body.charAt(offset) != '\n';
    }

    private static String snippet(String body, int offset) {
        int start = offset == body.length() ? Math.max(0, offset - 200) : offset;
        if (ReadingCoordinates.splitsPair(body, start)) start++;
        int end = Math.min(start + 200, body.length());
        if (ReadingCoordinates.splitsPair(body, end)) end--;
        String excerpt = body.substring(start, end).strip();
        return excerpt.isEmpty() ? null : excerpt;
    }

    public record Input(String workId, long chapterId, int offset, int contentVersion, String contentHash) { }
    public record Item(String id, String state, String workId, String workTitle, String kind, String chapterTitle,
            ReadingProgressResponse.Position position, String snippet, String createdAt) { }
    public record Page(List<Item> items, int page, boolean hasNext) { }
}
