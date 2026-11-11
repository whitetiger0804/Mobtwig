package com.mobtwig.home;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import com.mobtwig.work.Book;
import com.mobtwig.work.BookRepository;
import com.mobtwig.work.Author;
import com.mobtwig.work.Category;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.data.domain.Pageable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 간이 서버와 같은 홈 배치에서 실제 DB 작품을 표시하는지 검증합니다. */
class HomeServiceTest {
    @TempDir Path directory;
    private final ObjectMapper mapper = new ObjectMapper();
    private final BookRepository repository = mock(BookRepository.class);
    private final List<Book> published = new ArrayList<>();
    private HomeService service;

    @BeforeEach
    void prepare() throws Exception {
        Path homePath = directory.resolve("home.json");
        Files.copy(Path.of("sdui/home.json"), homePath, StandardCopyOption.REPLACE_EXISTING);
        JsonNode works = mapper.readTree(Files.readString(Path.of("mock/fixtures/works.json")));
        for (JsonNode work : works) {
            Book book = mock(Book.class);
            when(book.getSlug()).thenReturn(work.path("id").asString());
            when(book.getTitle()).thenReturn(work.path("title").asString());
            when(book.getCoverImageUrl()).thenReturn(work.path("imageUrl").asString());
            Author author = mock(Author.class);
            when(author.getName()).thenReturn(work.path("author").asString());
            Category category = mock(Category.class);
            when(category.getName()).thenReturn(work.path("category").asString());
            when(book.getAuthors()).thenReturn(List.of(author));
            when(book.getGenres()).thenReturn(List.of());
            when(book.getCategories()).thenReturn(List.of(category));
            String kind = work.path("kind").asString();
            when(book.getContentType()).thenReturn(switch (kind) {
                case "book" -> "BOOK";
                case "magazine" -> "MAGAZINE";
                case "novel" -> "WEBNOVEL";
                default -> throw new IllegalArgumentException("간이 작품의 분류가 올바르지 않습니다.");
            });
            published.add(book);
        }
        Collections.reverse(published);
        when(repository.findByPublishStatusOrderByPublishedDateDescIdDesc(eq("PUBLISHED"), any(Pageable.class)))
                .thenAnswer(invocation -> select(null, invocation.getArgument(1)));
        when(repository.findByPublishStatusAndContentTypeOrderByPublishedDateDescIdDesc(
                eq("PUBLISHED"), any(String.class), any(Pageable.class)))
                .thenAnswer(invocation -> select(invocation.getArgument(1), invocation.getArgument(2)));
        when(repository.findByPublishStatusOrderByWishlistCountDescAverageRatingDescPublishedDateDescIdDesc(
                eq("PUBLISHED"), any(Pageable.class)))
                .thenAnswer(invocation -> select(null, invocation.getArgument(1)));
        when(repository.findByPublishStatusAndContentTypeOrderByWishlistCountDescAverageRatingDescPublishedDateDescIdDesc(
                eq("PUBLISHED"), any(String.class), any(Pageable.class)))
                .thenAnswer(invocation -> select(invocation.getArgument(1), invocation.getArgument(2)));
        service = new HomeService(repository, mapper, homePath);
    }

    @Test
    void matchesMockSectionsWhileReadingDatabaseWorkLists() throws Exception {
        JsonNode expected = mapper.readTree(Files.readString(Path.of("mock/fixtures/home.json")));
        for (String kind : List.of("all", "book", "magazine", "novel")) {
            JsonNode actual = mapper.valueToTree(service.getHome(kind));
            JsonNode expectedSections = expected.path(kind).path("sections");
            assertEquals(expectedSections.size(), actual.path("sections").size(), kind);
            for (int index = 0; index < expectedSections.size(); index++) {
                ObjectNode expectedSection = (ObjectNode) expectedSections.path(index).deepCopy();
                ObjectNode actualSection = (ObjectNode) actual.path("sections").path(index).deepCopy();
                JsonNode expectedItems = expectedSection.path("items");
                JsonNode actualItems = actualSection.path("items");
                expectedSection.remove("items");
                actualSection.remove("items");
                assertEquals(expectedSection, actualSection, kind);
                assertEquals(expectedItems.size(), actualItems.size(), kind);
                if (!Set.of("workShelf", "featuredWork").contains(actualSection.path("type").asString())) {
                    assertEquals(expectedItems, actualItems);
                } else {
                    for (JsonNode item : actualItems) {
                        Book book = published.stream().filter(value -> value.getSlug().equals(item.path("id").asString()))
                                .findFirst().orElseThrow();
                        assertEquals(book.getTitle(), item.path("title").asString());
                        assertEquals(book.getCoverImageUrl(), item.path("imageUrl").asString());
                    }
                }
            }
        }
    }

    @Test
    void usesCurrentDatabaseTitlesAndCoverAddresses() throws Exception {
        Book book = published.stream().filter(value -> value.getContentType().equals("BOOK"))
                .findFirst().orElseThrow();
        when(book.getTitle()).thenReturn("DB에서 수정한 제목");
        when(book.getCoverImageUrl()).thenReturn("/media/covers/도서/수정 표지.png");
        JsonNode home = mapper.valueToTree(service.getHome("book"));
        JsonNode featured = home.path("sections").path(0).path("items").path(0);
        assertEquals("DB에서 수정한 제목", featured.path("title").asString());
        assertEquals("/media/covers/도서/수정 표지.png", featured.path("imageUrl").asString());
        assertEquals(featured.path("title"), home.path("sections").path(1).path("items").path(0).path("title"));
        assertEquals(book.getSlug(), featured.path("action").path("route").path("workId").asString());
        String category = book.getCategories().stream().map(value -> value.getName()).findFirst().orElseThrow();
        assertEquals(book.getAuthors().getFirst().getName() + " · " + category,
                featured.path("subtitle").asString());

        when(book.getCoverImageUrl()).thenReturn("https://images.example.test/changed-cover.png");
        home = mapper.valueToTree(service.getHome("book"));
        assertEquals("https://images.example.test/changed-cover.png",
                home.path("sections").path(0).path("items").path(0).path("imageUrl").asString());
    }

    @Test
    void keepsBannersAndLinksWithoutSubstitutingMissingDatabaseWorks() throws Exception {
        published.clear();
        for (String kind : List.of("all", "book", "magazine", "novel")) {
            JsonNode home = mapper.valueToTree(service.getHome(kind));
            for (JsonNode section : home.path("sections")) {
                assertFalse(section.has("dataSource"));
                if (Set.of("workShelf", "featuredWork").contains(section.path("type").asString())) {
                    assertEquals(0, section.path("items").size());
                }
            }
        }
        JsonNode home = mapper.valueToTree(service.getHome("all"));
        assertEquals(2, home.path("sections").path(0).path("items").size());
        assertEquals(3, home.path("sections").path(1).path("items").size());
    }

    /** 조회 메서드가 돌려준 공개 작품 목록을 분류와 조회 개수에 맞춰 준비합니다. */
    private List<Book> select(String contentType, Pageable page) {
        return published.stream().filter(book -> contentType == null || contentType.equals(book.getContentType()))
                .limit(page.getPageSize()).toList();
    }
}
