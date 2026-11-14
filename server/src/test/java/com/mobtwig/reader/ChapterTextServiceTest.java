package com.mobtwig.reader;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import com.mobtwig.work.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChapterTextServiceTest {
    private final BookRepository books = mock(BookRepository.class);
    private final ChapterRepository chapters = mock(ChapterRepository.class);
    private final PlainTextSource source = mock(PlainTextSource.class);
    private final Instant now = Instant.parse("2026-11-07T00:00:00Z");
    private final ChapterTextService service = new ChapterTextService(books, chapters, source, mock(TextVersionRegistry.class), Clock.fixed(now, ZoneOffset.UTC));

    @Test void gatesBeforeReadingAndNeverUsesAnotherWorkOrFallbackChapter() {
        when(books.findBySlugAndPublishStatus("hidden", "PUBLISHED")).thenReturn(Optional.empty());
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.read("hidden", "1")).getStatusCode().value());
        verifyNoInteractions(chapters, source);
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> service.read("bad/slug", "1")).getStatusCode().value());
        Book book = book();
        when(books.findBySlugAndPublishStatus("public", "PUBLISHED")).thenReturn(Optional.of(book));
        var only = List.of(chapter(20L, 1));
        when(chapters.findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(9L, now)).thenReturn(only);
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.read("public", "other-work-id")).getStatusCode().value());
        verifyNoInteractions(source);
    }

    @Test void usesPublicOrderRatherThanAddingToIdsAndReturnsExplicitNullBoundaries() {
        var publicBook = book();
        when(books.findBySlugAndPublishStatus("public", "PUBLISHED")).thenReturn(Optional.of(publicBook));
        var published = List.of(chapter(90L, 2), chapter(3L, 8), chapter(44L, 11));
        when(chapters.findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(9L, now)).thenReturn(published);
        when(source.read(anyString())).thenReturn(new PlainTextSource.Text("🌱\n", 3, "a".repeat(64)));
        var middle = service.read("public", "3");
        assertEquals("90", middle.previous().id()); assertEquals("44", middle.next().id());
        assertEquals(8, middle.chapter().number()); assertEquals(1, middle.currentIndex());
        assertEquals(4, middle.contentVersion()); assertEquals(3, middle.characterCount());
        assertNull(service.read("public", "90").previous());
        assertNull(service.read("public", "44").next());
        verify(books, never()).incrementViewCount(any());
        verify(chapters, never()).save(any());
    }

    private Book book() {
        Book b = mock(Book.class); when(b.getId()).thenReturn(9L); when(b.getTitle()).thenReturn("작품");
        when(b.getContentType()).thenReturn("WEBNOVEL"); return b;
    }
    private Chapter chapter(long id, int number) {
        Chapter c = mock(Chapter.class); when(c.getId()).thenReturn(id); when(c.getChapterNo()).thenReturn(number);
        when(c.getTitle()).thenReturn("장 " + number); when(c.getContentUrl()).thenReturn("/content/" + id + ".txt");
        when(c.getContentVersion()).thenReturn(4); return c;
    }
}
