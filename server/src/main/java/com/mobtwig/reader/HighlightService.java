package com.mobtwig.reader;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import com.mobtwig.purchase.PurchaseFailure;
import com.mobtwig.purchase.PurchaseService;
import com.mobtwig.reader.HighlightRepository.Saved;
import com.mobtwig.reader.ReadingProgressRepository.Chapter;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 소장 권한과 표시 원문을 확인하여 회원의 하이라이트를 저장·조회합니다. */
@Service
public class HighlightService {
    private final HighlightRepository highlights;
    private final ReadingProgressRepository works;
    private final ReadingCoordinates coordinates;
    private final PurchaseService purchases;

    HighlightService(HighlightRepository highlights, ReadingProgressRepository works, ReadingCoordinates coordinates,
            PurchaseService purchases) {
        this.highlights = highlights;
        this.works = works;
        this.coordinates = coordinates;
        this.purchases = purchases;
    }

    @Transactional(readOnly = true)
    public Page list(long member, String slug, Long chapter, int page) {
        var rows = highlights.list(member, slug, chapter, (page - 1L) * 30);
        var published = new HashMap<String, Optional<Work>>();
        var texts = new HashMap<String, PlainTextSource.Text>();
        Instant now = Instant.now();
        var items = rows.stream().limit(30).map(row -> describe(member, row,
                published.computeIfAbsent(row.slug(), key -> works.work(key, now, false)).orElse(null), texts)).toList();
        return new Page(items, page, rows.size() > 30);
    }

    @Transactional
    public Item save(long member, Input input) {
        lock(member);
        var work = works.work(input.workId(), Instant.now(), true).orElseThrow(ReadingProgressFailure::notFound);
        var chapter = visible(work, input.chapterId()).orElseThrow(ReadingProgressFailure::notFound);
        purchases.requireRead(member, work.id(), chapter.id());
        String snippet = check(work, chapter, input.startOffset(), input.endOffset(), input.contentVersion(), input.contentHash(), new HashMap<>());
        var saved = highlights.find(member, input).orElseGet(() -> highlights.insert(member, work.id(), input, snippet));
        return item(saved, work, chapter, "available", snippet);
    }

    @Transactional
    public void delete(long member, long id) {
        lock(member);
        if (!highlights.delete(member, id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "하이라이트가 없습니다.");
    }

    private Item describe(long member, Saved row, Work work, Map<String, PlainTextSource.Text> texts) {
        var chapter = visible(work, row.chapter()).orElse(null);
        if (chapter == null) {
            return new Item(Long.toString(row.id()), "hidden", null, null, null, null, null, null, null, row.created().toString());
        }
        try {
            purchases.requireRead(member, work.id(), chapter.id());
            return item(row, work, chapter, "available", check(work, chapter, row.start(), row.end(), row.version(), row.hash(), texts));
        } catch (PurchaseFailure unavailable) {
            return new Item(Long.toString(row.id()), "hidden", null, null, null, null, null, null, null, row.created().toString());
        } catch (ResponseStatusException changed) {
            return item(row, work, chapter, "stale", null);
        }
    }

    private String check(Work work, Chapter chapter, int start, int end, int version, String hash, Map<String, PlainTextSource.Text> texts) {
        var checked = coordinates.verify(work, chapter, start, version, hash, texts);
        if (work.magazine()) {
            if (end < start || checked.end() != null && end > checked.end()) throw ReadingProgressFailure.invalid();
            return null;
        }
        String body = checked.body();
        if (end <= start || end > body.length() || ReadingCoordinates.splitsPair(body, end)) throw ReadingProgressFailure.invalid();
        int stop = start + Math.min(500, end - start);
        if (ReadingCoordinates.splitsPair(body, stop)) stop--;
        return body.substring(start, stop);
    }

    private static Item item(Saved row, Work work, Chapter chapter, String state, String snippet) {
        var range = new Range(Long.toString(chapter.id()), row.start(), row.end(), work.magazine() ? "page" : "utf16",
                row.version(), row.hash());
        return new Item(Long.toString(row.id()), state, work.slug(), work.title(), work.kind(), chapter.title(),
                range, row.color(), snippet, row.created().toString());
    }

    private static Optional<Chapter> visible(Work work, long id) {
        return work == null ? Optional.empty() : work.visible().stream().filter(chapter -> chapter.id() == id).findFirst();
    }

    private void lock(long member) {
        if (!works.lockActiveMember(member)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }

    public record Input(String workId, long chapterId, int startOffset, int endOffset, int contentVersion, String contentHash, String color) { }
    public record Range(String chapterId, int startOffset, int endOffset, String unit, int contentVersion, String contentHash) { }
    public record Item(String id, String state, String workId, String workTitle, String kind, String chapterTitle,
            Range range, String color, String snippet, String createdAt) { }
    public record Page(List<Item> items, int page, boolean hasNext) { }
}
