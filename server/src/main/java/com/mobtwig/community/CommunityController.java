package com.mobtwig.community;

import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/** 공개 커뮤니티 조회와 쿠키·CSRF로 보호된 회원 작성을 제공합니다. */
@RestController
class CommunityController {
    private static final Set<String> HEADS = Set.of("IMPRESSION", "QUESTION", "THEORY", "FREE", "STORY", "PROMOTION");
    private static final Set<String> REASONS = Set.of("SPAM", "ABUSE", "INAPPROPRIATE", "SPOILER", "OTHER");
    private static final String SPACE = "[\\p{IsWhite_Space}\\uFEFF]";
    private static final Pattern EDGES = Pattern.compile("^" + SPACE + "++|(?<!" + SPACE + ")" + SPACE + "++$");
    private static final Pattern INLINE_IMAGE = Pattern.compile("!\\[이미지\\]\\(<([^<>\\r\\n]*)>\\)");
    private final CommunityService community;
    CommunityController(CommunityService community) { this.community = community; }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/boards")
    ResponseEntity<CommunityService.Boards> boards(@RequestParam MultiValueMap<String, String> query) {
        return ok(community.boards(type(value(query, "type", "work")), search(query)));
    }

    @GetMapping("/api/members/community/boards")
    ResponseEntity<CommunityService.Boards> memberBoards(@RequestParam MultiValueMap<String, String> query) { return boards(query); }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/works")
    ResponseEntity<CommunityService.Page<CommunityService.WorkBoard>> works(@RequestParam MultiValueMap<String, String> query) {
        return ok(community.works(search(query), positive(query, "page", 1, Integer.MAX_VALUE), positive(query, "size", 20, 50)));
    }

    @GetMapping("/api/members/community/works")
    ResponseEntity<CommunityService.Page<CommunityService.WorkBoard>> memberWorks(@RequestParam MultiValueMap<String, String> query) { return works(query); }

    @PostMapping(path = "/api/members/community/boards", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Board> createBoard(Principal principal, @RequestBody JsonNode input) {
        if (!input.isObject() || !input.has("type")) throw invalid();
        String kind = text(input.get("type"), 20, false);
        CommunityService.BoardResult result;
        if ("work".equals(kind)) {
            fields(input, Set.of("type", "workId"));
            String work = text(input.get("workId"), 100, false);
            if (!work.matches("[a-z0-9-]{1,100}")) throw invalid();
            result = community.createWorkBoard(member(principal), work);
        } else if ("topic".equals(kind)) {
            fields(input, Set.of("type", "name"));
            String name = text(input.get("name"), 100, false);
            if (name.isEmpty()) throw invalid();
            result = community.createTopicBoard(member(principal), name);
        } else throw invalid();
        return result.created() ? created(result.board()) : ok(result.board());
    }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/works/{slug}/chapters")
    ResponseEntity<CommunityService.Chapters> chapters(@PathVariable String slug) {
        return ok(community.chapters(slug));
    }

    @GetMapping("/api/members/community/works/{slug}/chapters")
    ResponseEntity<CommunityService.Chapters> memberChapters(@PathVariable String slug) { return chapters(slug); }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/posts")
    ResponseEntity<CommunityService.Page<CommunityService.Post>> list(@RequestParam MultiValueMap<String, String> query) {
        return list(query, null);
    }

    @GetMapping("/api/members/community/posts")
    ResponseEntity<CommunityService.Page<CommunityService.Post>> memberList(@RequestParam MultiValueMap<String, String> query,
                                                                          Principal principal) { return list(query, member(principal)); }

    private ResponseEntity<CommunityService.Page<CommunityService.Post>> list(MultiValueMap<String, String> query, Long viewer) {
        String board = value(query, "boardId", null), mode = value(query, "type", null), head = value(query, "head", null);
        String search = search(query);
        if (head != null && !HEADS.contains(head)) throw invalid();
        var filter = new CommunityRepository.Filter(board == null ? null : id(board), mode == null ? null : type(mode),
                head, search, flag(query, "mine"), viewer);
        return ok(community.list(filter, positive(query, "page", 1, Integer.MAX_VALUE), positive(query, "size", 20, 50)));
    }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/posts/{postId}")
    ResponseEntity<CommunityService.Post> post(@PathVariable String postId, @RequestParam MultiValueMap<String, String> query) {
        return ok(community.post(id(postId), null, flag(query, "reveal")));
    }

    @GetMapping("/api/members/community/posts/{postId}")
    ResponseEntity<CommunityService.Post> memberPost(@PathVariable String postId, @RequestParam MultiValueMap<String, String> query,
                                                    Principal principal) { return ok(community.post(id(postId), member(principal), flag(query, "reveal"))); }

    @PostMapping(path = "/api/members/community/posts", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Post> create(Principal principal, @RequestBody JsonNode input) throws IOException {
        return created(community.create(member(principal), draft(input)));
    }

    @PutMapping(path = "/api/members/community/posts/{postId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Post> update(@PathVariable String postId, Principal principal, @RequestBody JsonNode input) throws IOException {
        return ok(community.update(id(postId), member(principal), draft(input)));
    }

    @DeleteMapping("/api/members/community/posts/{postId}")
    ResponseEntity<Void> delete(@PathVariable String postId, Principal principal) {
        community.delete(id(postId), member(principal)); return empty();
    }

    @GetMapping("/api/members/community/draft")
    ResponseEntity<CommunityService.Post> draft(Principal principal) {
        return community.draft(member(principal)).map(CommunityController::ok)
                .orElseGet(() -> ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build());
    }

    @PutMapping(path = "/api/members/community/draft", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Post> saveDraft(Principal principal, @RequestBody JsonNode input) throws IOException {
        return ok(community.saveDraft(member(principal), draft(input)));
    }

    @DeleteMapping("/api/members/community/draft")
    ResponseEntity<Void> deleteDraft(Principal principal) { community.deleteDraft(member(principal)); return empty(); }

    @CrossOrigin(origins = "*")
    @GetMapping("/community/posts/{postId}/comments")
    ResponseEntity<CommunityService.Page<CommunityService.Comment>> comments(@PathVariable String postId,
            @RequestParam MultiValueMap<String, String> query) { return comments(postId, query, null); }

    @GetMapping("/api/members/community/posts/{postId}/comments")
    ResponseEntity<CommunityService.Page<CommunityService.Comment>> memberComments(@PathVariable String postId,
            @RequestParam MultiValueMap<String, String> query, Principal principal) { return comments(postId, query, member(principal)); }

    private ResponseEntity<CommunityService.Page<CommunityService.Comment>> comments(String postId,
            MultiValueMap<String, String> query, Long viewer) {
        var reveals = new HashSet<Long>();
        String selected = value(query, "revealIds", null);
        if (selected != null) {
            String[] ids = selected.split(",", -1);
            if (ids.length > 50) throw invalid();
            for (String item : ids) reveals.add(id(item));
        }
        return ok(community.comments(id(postId), viewer, flag(query, "reveal"), flag(query, "revealPost"), reveals,
                positive(query, "page", 1, Integer.MAX_VALUE), positive(query, "size", 20, 50)));
    }

    @PostMapping(path = "/api/members/community/posts/{postId}/comments", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Comment> createComment(@PathVariable String postId, Principal principal, @RequestBody JsonNode input) {
        return created(community.createComment(id(postId), member(principal), comment(input)));
    }

    @PutMapping(path = "/api/members/community/comments/{commentId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Comment> updateComment(@PathVariable String commentId, Principal principal, @RequestBody JsonNode input) {
        return ok(community.updateComment(id(commentId), member(principal), comment(input)));
    }

    @DeleteMapping("/api/members/community/comments/{commentId}")
    ResponseEntity<Void> deleteComment(@PathVariable String commentId, Principal principal) {
        community.deleteComment(id(commentId), member(principal)); return empty();
    }

    @PutMapping("/api/members/community/posts/{postId}/like")
    ResponseEntity<CommunityService.LikeState> like(@PathVariable String postId, Principal principal) {
        return ok(community.like(id(postId), member(principal), true));
    }

    @DeleteMapping("/api/members/community/posts/{postId}/like")
    ResponseEntity<CommunityService.LikeState> unlike(@PathVariable String postId, Principal principal) {
        return ok(community.like(id(postId), member(principal), false));
    }

    @PostMapping(path = "/api/members/community/posts/{postId}/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.Report> report(@PathVariable String postId, Principal principal, @RequestBody JsonNode input) {
        fields(input, Set.of("reason", "detail"));
        String reason = text(input.get("reason"), 20, false), detail = text(input.get("detail"), 500, true);
        if (!REASONS.contains(reason)) throw invalid();
        var result = community.report(id(postId), member(principal), reason, detail);
        return result.created() ? created(result.report()) : ok(result.report());
    }

    @PostMapping(path = "/api/members/community/images", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommunityService.ImageInput> upload(Principal principal, @RequestBody JsonNode input) throws IOException {
        fields(input, Set.of("base64", "mimeType"));
        if (!input.get("base64").isString() || !input.get("mimeType").isString()) throw invalid();
        return created(community.upload(member(principal), input.get("base64").asString(), input.get("mimeType").asString()));
    }

    @CrossOrigin(origins = "*")
    @GetMapping(path = "/community/images/{owner}/{name}", produces = MediaType.IMAGE_PNG_VALUE)
    ResponseEntity<byte[]> image(@PathVariable String owner, @PathVariable String name,
            @RequestParam MultiValueMap<String, String> query) throws IOException { return image(owner, name, query, null); }

    @GetMapping(path = "/api/members/community/images/{owner}/{name}", produces = MediaType.IMAGE_PNG_VALUE)
    ResponseEntity<byte[]> memberImage(@PathVariable String owner, @PathVariable String name,
            @RequestParam MultiValueMap<String, String> query, Principal principal) throws IOException { return image(owner, name, query, member(principal)); }

    private ResponseEntity<byte[]> image(String owner, String name, MultiValueMap<String, String> query, Long viewer) throws IOException {
        byte[] image = community.image(id(owner), name, viewer, flag(query, "reveal"));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(image);
    }

    private static CommunityService.Draft draft(JsonNode input) {
        spoilerFields(input, Set.of("boardId", "workId", "head", "title", "body", "spoilerChapterId", "images", "stickerIds"));
        String work = text(input.get("workId"), 100, true);
        if (work != null && !work.matches("[a-z0-9-]+")) throw invalid();
        String head = text(input.get("head"), 20, false);
        if (!HEADS.contains(head)) throw invalid();
        var values = input.get("images");
        if (!values.isArray() || values.size() > 3) throw invalid();
        var attachments = new ArrayList<CommunityService.ImageInput>();
        var urls = new HashSet<String>();
        for (var image : values) {
            fields(image, Set.of("url", "width", "height"));
            String url = text(image.get("url"), 500, false);
            if (!urls.add(url)) throw invalid();
            attachments.add(new CommunityService.ImageInput(url, dimension(image.get("width")), dimension(image.get("height"))));
        }
        Long chapter = jsonId(input.get("spoilerChapterId"), true);
        return new CommunityService.Draft(jsonId(input.get("boardId"), false), work, head,
                text(input.get("title"), 100, false), body(input.get("body"), attachments),
                chapter, hasSpoiler(input, chapter), attachments, stickerIds(input.get("stickerIds"), 8));
    }

    /** 등록된 첨부 수만큼의 이미지 표식만 제외하고 표시 본문의 코드 포인트 수를 제한합니다. */
    private static String body(JsonNode input, List<CommunityService.ImageInput> images) {
        String body = text(input, 25000, false);
        int length = body.codePointCount(0, body.length());
        var remaining = new ArrayList<>(images.stream().map(image -> imageKey(image.url())).toList());
        var markers = INLINE_IMAGE.matcher(body);
        while (markers.find()) {
            String target = imageKey(markers.group(1));
            for (int index = 0; index < remaining.size(); index++) {
                String url = remaining.get(index);
                if (target.equals(url) || target.equals(imageHref(url))) {
                    length -= body.codePointCount(markers.start(), markers.end());
                    remaining.remove(index);
                    break;
                }
            }
        }
        if (length > 10000) throw invalid();
        return body;
    }

    private static String imageKey(String url) {
        var managed = CommunityImages.URL.matcher(url);
        return managed.matches() ? "/community/images/" + managed.group(1) + "/" + managed.group(2) : url;
    }

    /** 클라이언트의 encodeURI와 같이 목적지를 인코딩하되 기존 퍼센트 인코딩은 보존합니다. */
    private static String imageHref(String url) {
        var encoded = new StringBuilder();
        for (byte value : url.getBytes(StandardCharsets.UTF_8)) {
            int character = value & 0xff;
            if (character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
                    || character >= '0' && character <= '9' || ";,/?:@&=+$-_.!~*'()#".indexOf(character) >= 0) {
                encoded.append((char) character);
            } else {
                encoded.append('%').append("0123456789ABCDEF".charAt(character >> 4))
                        .append("0123456789ABCDEF".charAt(character & 15));
            }
        }
        return encoded.toString().replaceAll("%25([0-9a-fA-F]{2})", "%$1");
    }

    private static CommunityService.CommentDraft comment(JsonNode input) {
        spoilerFields(input, Set.of("body", "spoilerChapterId", "stickerIds"));
        Long chapter = jsonId(input.get("spoilerChapterId"), true);
        return new CommunityService.CommentDraft(text(input.get("body"), 2000, true),
                chapter, hasSpoiler(input, chapter), stickerIds(input.get("stickerIds"), 4));
    }

    /** 이전 요청은 회차 지정 여부를 사용하며 새 요청은 명시한 토글 값을 사용합니다. */
    private static boolean hasSpoiler(JsonNode input, Long chapter) {
        if (!input.has("hasSpoiler")) return chapter != null;
        if (!input.get("hasSpoiler").isBoolean()) throw invalid();
        boolean hasSpoiler = input.get("hasSpoiler").asBoolean();
        if (!hasSpoiler && chapter != null) throw invalid();
        return hasSpoiler;
    }

    private static void spoilerFields(JsonNode input, Set<String> expected) {
        var fields = new HashSet<>(expected);
        if (input.has("hasSpoiler")) fields.add("hasSpoiler");
        fields(input, fields);
    }

    private static List<Long> stickerIds(JsonNode input, int max) {
        if (!input.isArray() || input.size() > max) throw invalid();
        var ids = new ArrayList<Long>();
        for (var item : input) ids.add(jsonId(item, false));
        return ids;
    }

    private static int dimension(JsonNode value) {
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.asInt() < 1) throw invalid();
        return value.asInt();
    }

    private static Long jsonId(JsonNode value, boolean nullable) {
        if (nullable && value.isNull()) return null;
        if (!value.isString()) throw invalid();
        return id(value.asString());
    }

    private static void fields(JsonNode input, Set<String> expected) {
        if (!input.isObject() || input.size() != expected.size() || expected.stream().anyMatch(field -> !input.has(field))) throw invalid();
    }

    private static String text(JsonNode node, int limit, boolean nullable) {
        if (nullable && node.isNull()) return null;
        if (!node.isString()) throw invalid();
        String value = clean(node.asString());
        if (value.codePointCount(0, value.length()) > limit) throw invalid();
        return nullable && value.isEmpty() ? null : value;
    }

    private static String clean(String text) { return EDGES.matcher(text).replaceAll(""); }
    private static String search(MultiValueMap<String, String> query) {
        String search = clean(value(query, "query", ""));
        if (search.codePointCount(0, search.length()) > 100) throw invalid();
        return search;
    }
    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }
    private static String type(String value) {
        if (!Set.of("work", "topic", "promotion").contains(value)) throw invalid();
        return value.toUpperCase(Locale.ROOT);
    }

    private static long id(String value) {
        if (!value.matches("-?[1-9][0-9]{0,18}")) throw invalid();
        var number = new BigInteger(value);
        if (number.compareTo(BigInteger.valueOf(Long.MIN_VALUE)) < 0 || number.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0) throw invalid();
        return number.longValue();
    }

    private static String value(MultiValueMap<String, String> query, String name, String defaultValue) {
        var values = query.get(name);
        if (values == null) return defaultValue;
        if (values.size() != 1) throw invalid();
        return values.getFirst();
    }

    private static boolean flag(MultiValueMap<String, String> query, String name) {
        String value = value(query, name, "false");
        if (!value.equals("true") && !value.equals("false")) throw invalid();
        return value.equals("true");
    }

    private static int positive(MultiValueMap<String, String> query, String name, int fallback, int max) {
        String value = value(query, name, Integer.toString(fallback));
        if (!value.matches("[0-9]{1,10}")) throw invalid();
        long number = Long.parseLong(value);
        if (number < 1 || number > max) throw invalid();
        return (int) number;
    }

    private static <T> ResponseEntity<T> ok(T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
    private static <T> ResponseEntity<T> created(T value) { return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(value); }
    private static ResponseEntity<Void> empty() { return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build(); }
    private static ResponseStatusException invalid() { return CommunityService.invalid("커뮤니티 요청 값이 올바르지 않습니다."); }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> rejected(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("message", Objects.requireNonNull(failure.getReason())));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> malformed() { return rejected(invalid()); }

    @ExceptionHandler(IOException.class)
    ResponseEntity<Map<String, String>> storageFailed() {
        return rejected(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "첨부 이미지를 저장하거나 읽지 못했습니다."));
    }
}
