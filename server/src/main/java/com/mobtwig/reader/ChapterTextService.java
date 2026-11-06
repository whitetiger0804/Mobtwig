package com.mobtwig.reader;

import java.time.Clock;
import java.time.Instant;
import com.mobtwig.work.BookRepository;
import com.mobtwig.work.ChapterRepository;
import com.mobtwig.work.WorkMetadata;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 여부를 먼저 검사하고 조회수·진도를 변경하지 않는 본문 조회입니다. */
@Service
public class ChapterTextService {
    private final BookRepository books;
    private final ChapterRepository chapters;
    private final PlainTextSource source;
    private final Clock clock;

    @Autowired
    public ChapterTextService(BookRepository books, ChapterRepository chapters, PlainTextSource source) {
        this(books, chapters, source, Clock.systemUTC());
    }

    ChapterTextService(BookRepository books, ChapterRepository chapters, PlainTextSource source, Clock clock) {
        this.books = books; this.chapters = chapters; this.source = source; this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ChapterTextResponse read(String slug, String chapterId) {
        if (slug == null || slug.length() > 120 || !slug.matches("[a-z0-9-]+")
                || chapterId == null || chapterId.length() > 80 || !chapterId.matches("[A-Za-z0-9_-]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "식별자가 올바르지 않습니다.");
        }
        var book = books.findBySlugAndPublishStatus(slug, "PUBLISHED").orElseThrow(ChapterTextService::notFound);
        var published = chapters.findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(book.getId(), Instant.now(clock));
        int index = -1;
        for (int i = 0; i < published.size(); i++) if (published.get(i).getId().toString().equals(chapterId)) index = i;
        if (index < 0) throw notFound();
        var refs = published.stream().map(c -> new ChapterTextResponse.ChapterRef(c.getId().toString(), c.getTitle(), c.getChapterNo())).toList();
        var text = source.read(published.get(index).getContentUrl());
        return new ChapterTextResponse(slug, book.getTitle(), WorkMetadata.kind(book.getContentType()),
                refs.get(index), refs, index, index == 0 ? null : refs.get(index - 1),
                index + 1 == refs.size() ? null : refs.get(index + 1),
                text.body(), text.characterCount(), published.get(index).getContentVersion(), text.version());
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "공개된 회차가 없습니다.");
    }
}
