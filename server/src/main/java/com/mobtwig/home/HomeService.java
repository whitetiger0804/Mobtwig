package com.mobtwig.home;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import com.mobtwig.work.Book;
import com.mobtwig.work.BookRepository;
import com.mobtwig.work.WorkMetadata;
import org.springframework.beans.factory.annotation.Value;
import org.jspecify.annotations.NonNull;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** 외부 JSON의 홈 구성을 읽고 작품 구역에 DB의 공개 작품을 채웁니다. */
@Service
public class HomeService {
    private final BookRepository bookRepository;
    private final ObjectMapper mapper;
    private final Path homePath;

    /**
     * 작품 저장소와 홈 구성 파일을 주입받습니다.
     * @param bookRepository 작품 저장소입니다.
     * @param mapper JSON 변환기입니다.
     * @param homePath 요청마다 읽을 UTF-8 홈 구성 파일입니다.
     */
    public HomeService(BookRepository bookRepository, ObjectMapper mapper,
            @Value("${mobtwig.sdui.home-path}") Path homePath) {
        this.bookRepository = bookRepository;
        this.mapper = mapper;
        this.homePath = homePath;
    }

    /**
     * 파일의 구역 순서를 유지하고 publishedWorks 자료원을 공개 작품으로 채웁니다.
     * @param kind all, book, magazine, novel 중 하나입니다.
     * @return 빈 작품 목록도 표현할 수 있는 홈 응답입니다.
     * @throws ResponseStatusException 지원하지 않는 분류이면 발생합니다.
     * @throws IOException 구성 파일을 읽지 못하면 발생합니다.
     * @throws IllegalStateException 홈 구성이나 자료원 설정이 올바르지 않으면 발생합니다.
     */
    @Transactional(readOnly = true)
    public HomeResponse getHome(String kind) throws IOException {
        String contentType = switch (kind) {
            case "all" -> null;
            case "book" -> "BOOK";
            case "magazine" -> "MAGAZINE";
            case "novel" -> "WEBNOVEL";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "지원하지 않는 작품 분류입니다.");
        };
        Map<String, HomeResponse> homes = mapper.readValue(
                Files.readString(homePath, StandardCharsets.UTF_8), new TypeReference<>() { });
        HomeResponse home = homes.get(kind);
        if (home == null || home.version() != 1 || home.sections() == null) {
            throw new IllegalStateException("요청한 홈의 구성이 올바르지 않습니다.");
        }
        for (ObjectNode section : home.sections()) {
            JsonNode source = section.remove("dataSource");
            if (source == null) {
                continue;
            }
            String type = section.path("type").asString();
            if (!"publishedWorks".equals(source.path("type").asString())
                    || !("workShelf".equals(type) || "featuredWork".equals(type))
                    || !source.path("limit").isIntegralNumber()
                    || !source.path("limit").canConvertToInt()) {
                throw new IllegalStateException("홈 구역의 자료원 설정이 올바르지 않습니다.");
            }
            int limit = source.path("limit").intValue();
            if (limit < 1 || limit > 20) {
                throw new IllegalStateException("홈 작품 개수는 1개 이상 20개 이하여야 합니다.");
            }
            ArrayNode items = mapper.valueToTree(publishedWorks(contentType, limit));
            if ("featuredWork".equals(type)) {
                String label = WorkMetadata.requiredText(source.path("label").asString(), "추천 문구");
                for (JsonNode item : items) {
                    ((ObjectNode) item).put("label", label);
                }
            }
            section.set("items", items);
        }
        return home;
    }

    /** 분류와 개수에 해당하는 최신 공개 작품 카드를 조회합니다. */
    private List<HomeResponse.@NonNull WorkItem> publishedWorks(String contentType, int limit) {
        PageRequest page = PageRequest.of(0, limit);
        List<Book> books = contentType == null
                ? bookRepository.findByPublishStatusOrderByPublishedDateDescIdDesc("PUBLISHED", page)
                : bookRepository.findByPublishStatusAndContentTypeOrderByPublishedDateDescIdDesc("PUBLISHED", contentType, page);
        return books.stream().map(book -> new HomeResponse.WorkItem(
                WorkMetadata.slug(book.getSlug()), WorkMetadata.requiredText(book.getTitle(), "제목"),
                WorkMetadata.imageUrl(book.getCoverImageUrl()))).toList();
    }
}
