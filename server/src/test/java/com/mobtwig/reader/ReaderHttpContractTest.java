package com.mobtwig.reader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import com.mobtwig.work.*;
import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import io.swagger.v3.parser.OpenAPIV3Parser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** DB만 모의하고 실제 서비스·파일 공급·HTTP 직렬화·OpenAPI 계약을 연결합니다. */
class ReaderHttpContractTest {
    @TempDir Path root;

    @Test void validatesFirstMiddleLastAndSingleIncludingExplicitNullAndExportsRealJson() throws Exception {
        Files.writeString(root.resolve("one.txt"), "\uFEFF  첫 🌱\r\n\r\n마지막 줄\r", StandardCharsets.UTF_8);
        var books = mock(BookRepository.class); var chapters = mock(ChapterRepository.class);
        var b = mock(Book.class); when(b.getId()).thenReturn(1L); when(b.getTitle()).thenReturn("실제 직렬화");
        when(b.getContentType()).thenReturn("BOOK");
        when(books.findBySlugAndPublishStatus("contract", "PUBLISHED")).thenReturn(Optional.of(b));
        var list = List.of(chapter(91, 2), chapter(12, 8), chapter(77, 10));
        when(chapters.findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(eq(1L), any(Instant.class))).thenReturn(list);
        var service = new ChapterTextService(books, chapters, new PlainTextSource(root.toString()));
        var mvc = MockMvcBuilders.standaloneSetup(new ChapterTextController(service)).setControllerAdvice(new ReaderErrors()).build();
        String spec = new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        var parsed = new OpenAPIV3Parser().readContents(spec);
        assertTrue(parsed.getMessages().isEmpty(), () -> parsed.getMessages().toString());
        var validator = OpenApiInteractionValidator.createForInlineApiSpecification(spec).withResolveCombinators(true).build();
        var mapper = new ObjectMapper(); var responses = new ArrayList<Object>();
        var single = List.of(chapter(91, 2));
        for (String id : List.of("91", "12", "77", "single")) {
            if (id.equals("single")) when(chapters.findByBookIdAndPublishedAtLessThanEqualOrderByChapterNoAsc(eq(1L), any(Instant.class))).thenReturn(single);
            String path = "/works/contract/chapters/" + (id.equals("single") ? "91" : id);
            var http = mvc.perform(get(path)).andReturn().getResponse();
            assertEquals(200, http.getStatus()); assertEquals("no-store", http.getHeader("Cache-Control"));
            String body = http.getContentAsString(StandardCharsets.UTF_8);
            var report = validator.validateResponse(path, Request.Method.GET,
                    SimpleResponse.Builder.ok().withContentType("application/json").withBody(body).build());
            assertFalse(report.hasErrors(), () -> report.getMessages().toString());
            var json = mapper.readTree(body); assertEquals("  첫 🌱\n\n마지막 줄\n", json.get("body").asString());
            if (id.equals("single")) { assertTrue(json.get("previous").isNull()); assertTrue(json.get("next").isNull()); }
            responses.add(json);
        }
        Files.createDirectories(Path.of("target"));
        Files.writeString(Path.of("target/reader-contract.json"), mapper.writeValueAsString(responses));
        for (String path : List.of("/works/hidden/chapters/91", "/works/contract/chapters/missing")) {
            var http = mvc.perform(get(path)).andReturn().getResponse(); assertEquals(404, http.getStatus());
            assertFalse(http.getContentAsString().contains(root.toString()));
        }
        when(books.findBySlugAndPublishStatus("failure", "PUBLISHED"))
                .thenThrow(new IllegalStateException("private SQL and filesystem details"));
        var failed = mvc.perform(get("/works/failure/chapters/91")).andReturn().getResponse();
        assertEquals(500, failed.getStatus());
        assertFalse(failed.getContentAsString().contains("private SQL"));
        var errors = validator.validateResponse("/works/failure/chapters/91", Request.Method.GET,
                SimpleResponse.Builder.status(500).withContentType("application/json")
                        .withBody(failed.getContentAsString(StandardCharsets.UTF_8)).build());
        assertFalse(errors.hasErrors(), () -> errors.getMessages().toString());
    }

    private Chapter chapter(long id, int number) {
        var c = mock(Chapter.class); when(c.getId()).thenReturn(id); when(c.getChapterNo()).thenReturn(number);
        when(c.getTitle()).thenReturn("장 " + number); when(c.getContentUrl()).thenReturn("/content/one.txt");
        when(c.getContentVersion()).thenReturn(3); return c;
    }
}
