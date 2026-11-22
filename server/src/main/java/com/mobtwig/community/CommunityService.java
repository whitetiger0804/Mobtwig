package com.mobtwig.community;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 게시판별 작성 규칙, 소유권과 스포일러 공개 범위를 처리합니다. */
@Service
class CommunityService {
    record Work(String id, String title, String author, String imageUrl, String kind) {}
    record Chapter(String id, int number, String title) {}
    record Sticker(String id, String code, String name, String imageUrl) {}
    record Image(String url, int width, int height, boolean representative) {}
    record LatestPost(String id, String head, String title, String nickname, long likeCount, long commentCount,
                      boolean hasSpoiler, boolean locked) {}
    record Board(String id, String type, String name, Work work, List<String> heads, LatestPost latestPost) {}
    record BoardResult(Board board, boolean created) {}
    record Boards(List<Board> items, List<Sticker> stickers) {}
    record WorkBoard(Work work, String boardId) {}
    record Chapters(List<Chapter> items) {}
    record Post(String id, String boardId, String boardType, String boardName, Work work, String head,
                String title, String body, String nickname, Instant createdAt, Instant updatedAt,
                Instant publishedAt, String status, Chapter spoiler, boolean hasSpoiler, boolean locked, boolean mine,
                boolean liked, boolean reported, long likeCount, long commentCount, List<Image> images, List<Sticker> stickers) {}
    record Comment(String id, String postId, String body, String nickname, Instant createdAt, Instant updatedAt,
                   Chapter spoiler, boolean hasSpoiler, boolean locked, boolean mine, List<Sticker> stickers) {}
    record Page<T>(List<T> items, int page, int size, long totalItems, boolean hasNext) {}
    record Draft(long boardId, String workId, String head, String title, String body, Long spoilerChapterId, boolean hasSpoiler,
                 List<ImageInput> images, List<Long> stickerIds) {}
    record ImageInput(String url, int width, int height) {}
    record CommentDraft(String body, Long spoilerChapterId, boolean hasSpoiler, List<Long> stickerIds) {}
    record LikeState(boolean liked, long likeCount) {}
    record Report(String id, boolean reported) {}
    record ReportResult(Report report, boolean created) {}

    private final CommunityRepository repository;
    private final CommunityImages images;
    CommunityService(CommunityRepository repository, CommunityImages images) { this.repository = repository; this.images = images; }

    /** 공개 작품 게시판과 주제·홍보 게시판을 이름으로 검색합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Boards boards(String type, String query) {
        var boards = repository.boards(type, query);
        var latest = repository.latestPosts(boards.stream().map(CommunityRepository.BoardData::id).toList());
        return new Boards(boards.stream().map(board -> project(board, latest.get(board.id()))).toList(), repository.stickers());
    }

    /** 게시판이 없는 작품도 포함하여 공개 작품과 게시판 식별자를 함께 조회합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<WorkBoard> works(String query, int page, int size) {
        long offset = (page - 1L) * size;
        var items = repository.works(query, size, offset);
        long total = repository.workCount(query);
        return new Page<>(items, page, size, total, offset + items.size() < total);
    }

    /** 로그인한 회원이 공개 작품의 게시판을 만들며 기존 게시판은 그대로 반환합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public BoardResult createWorkBoard(long member, String slug) {
        repository.lockMember(member);
        long book = repository.lockBook(slug);
        var existing = repository.workBoard(book);
        if (existing.isPresent()) return boardResult(existing.get(), false);
        long id = repository.insertBoard("WORK", book, null);
        return boardResult(repository.board(id).orElseThrow(CommunityService::notFound), true);
    }

    /** 같은 주제명은 DB의 고유 제약으로 한 번만 생성합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public BoardResult createTopicBoard(long member, String name) {
        repository.lockMember(member);
        var existing = repository.topicBoard(name);
        if (existing.isPresent()) return boardResult(existing.get(), false);
        try {
            long id = repository.insertBoard("TOPIC", null, name);
            return boardResult(repository.board(id).orElseThrow(CommunityService::notFound), true);
        } catch (DuplicateKeyException duplicate) {
            // 다른 회원이 같은 이름을 먼저 생성한 경우에만 그 게시판을 반환합니다.
            var board = repository.topicBoard(name).orElseThrow(() -> duplicate);
            return boardResult(board, false);
        }
    }

    /** 조회 수를 올리지 않고 공개 회차의 스포일러 선택지를 제공합니다. */
    @Transactional(readOnly = true)
    public Chapters chapters(String slug) {
        return new Chapters(repository.chapters(repository.book(slug).orElseThrow(CommunityService::notFound)));
    }

    /** 공개 글 또는 본인이 게시한 글을 안정적인 게시 시각 순서로 조회합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<Post> list(CommunityRepository.Filter filter, int page, int size) {
        if (filter.mine() && filter.viewer() == null) throw unauthorized();
        long offset = (page - 1L) * size;
        var posts = repository.posts(filter, size, offset);
        var readable = posts.stream().filter(p -> !locked(p.hasSpoiler(), p.memberId(), filter.viewer(), false))
                .map(CommunityRepository.PostData::id).toList();
        var attachments = repository.images(readable);
        var stickers = repository.selectedStickers(readable, false);
        var items = posts.stream().map(p -> project(p, filter.viewer(), !readable.contains(p.id()),
                attachments.getOrDefault(p.id(), List.of()), stickers.getOrDefault(p.id(), List.of()))).toList();
        long total = repository.postCount(filter);
        return new Page<>(items, page, size, total, offset + items.size() < total);
    }

    /** 확인 전에는 스포일러 제목·본문·이미지·스티커를 응답에서 제외합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Post post(long id, Long viewer, boolean reveal) { return project(readablePost(id, viewer), viewer, reveal); }

    /** 계정별 하나의 비공개 초안을 조회합니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<Post> draft(long member) {
        return repository.draftId(member).map(id -> project(repository.post(id, member).orElseThrow(CommunityService::notFound), member, true));
    }

    /** 회원 행을 잠가 동시에 저장해도 하나의 초안만 유지합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Post saveDraft(long member, Draft input) throws IOException {
        repository.lockMember(member);
        var old = repository.draftId(member);
        long id = persist(member, old.orElse(null), input, validate(input, false), false);
        return project(repository.post(id, member).orElseThrow(CommunityService::notFound), member, true);
    }

    /** 새 글을 게시하며 별도로 저장된 서버 초안을 변경하지 않습니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Post create(long member, Draft input) throws IOException {
        repository.lockMember(member);
        long id = persist(member, null, input, validate(input, true), true);
        return project(repository.post(id, member).orElseThrow(CommunityService::notFound), member, true);
    }

    /** 게시한 글의 게시판과 연결 작품을 보존하며 본문·첨부 자료를 수정합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Post update(long id, long member, Draft input) throws IOException {
        repository.lockMember(member); repository.lockPost(id);
        var old = ownedPost(id, member);
        if (!List.of("PUBLISHED", "HIDDEN").contains(old.status())) throw notFound();
        Long book = validate(input, true);
        if (input.boardId() != old.boardId() || !Objects.equals(book, old.bookId()))
            throw invalid("게시한 글의 게시판과 연결 작품은 바꿀 수 없습니다.");
        persist(member, id, input, book, true);
        return project(repository.post(id, member).orElseThrow(CommunityService::notFound), member, true);
    }

    private long persist(long member, Long id, Draft input, Long book, boolean publish) throws IOException {
        var existing = id == null ? List.<CommunityRepository.SavedImage>of() : repository.images(id);
        var attachments = new java.util.ArrayList<CommunityRepository.SavedImage>();
        for (int i = 0; i < input.images().size(); i++) {
            var image = input.images().get(i);
            // 기존 시드의 외부 이미지는 본인 글 수정 시에만 같은 값으로 보존합니다.
            var kept = existing.stream().filter(old -> old.url().equals(image.url()) && old.width() == image.width()
                    && old.height() == image.height()).findFirst();
            String canonical = kept.isPresent() && !images.isManaged(image.url()) ? kept.get().url() : images.validate(member, image);
            attachments.add(new CommunityRepository.SavedImage(canonical, image.width(), image.height(), i == 0));
        }
        long saved;
        if (id == null) saved = repository.insert(member, input, book, publish);
        else { repository.update(id, input, book, publish); saved = id; }
        repository.replaceAttachments(saved, attachments, input.stickerIds());
        return saved;
    }

    private Long validate(Draft input, boolean publishing) {
        var board = repository.board(input.boardId()).orElseThrow(CommunityService::notFound);
        if (!heads(board.type()).contains(input.head())) throw invalid("게시판에 맞는 말머리를 선택해 주세요.");
        if (publishing && (input.title().isEmpty() || input.body().isEmpty())) throw invalid("제목과 본문을 입력해 주세요.");
        Long book = input.workId() == null ? null : repository.book(input.workId()).orElseThrow(CommunityService::notFound);
        if ("WORK".equals(board.type())) {
            if (book != null && !book.equals(board.bookId())) throw invalid("게시판과 연결 작품이 일치하지 않습니다.");
            book = board.bookId();
        }
        if ("PROMOTION".equals(board.type()) && book == null) throw invalid("홍보할 작품을 선택해 주세요.");
        validateSpoiler(input.spoilerChapterId(), book);
        validateStickers(input.stickerIds());
        return book;
    }

    /** 게시된 글은 상태만 바꾸고 댓글·공감·신고를 보존합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void delete(long id, long member) {
        repository.lockMember(member); repository.lockPost(id);
        var old = ownedPost(id, member);
        if ("DELETED".equals(old.status())) throw notFound();
        repository.delete(id, "DRAFT".equals(old.status()));
    }

    /** 현재 계정의 초안만 실제 삭제합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void deleteDraft(long member) {
        repository.lockMember(member);
        repository.draftId(member).ifPresent(id -> repository.delete(id, true));
    }

    /** 공개 글의 댓글을 조회하며 회차별 스포일러는 댓글마다 가립니다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<Comment> comments(long post, Long viewer, boolean reveal, boolean revealPost, Set<Long> revealIds, int page, int size) {
        var parent = publishedPost(post, viewer);
        if (locked(parent.hasSpoiler(), parent.memberId(), viewer, reveal || revealPost))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "스포일러를 확인한 뒤 댓글을 열어 주세요.");
        long offset = (page - 1L) * size;
        var comments = repository.comments(post, size, offset);
        var readable = comments.stream().filter(c -> !locked(c.hasSpoiler(), c.memberId(), viewer, reveal || revealIds.contains(c.id())))
                .map(CommunityRepository.CommentData::id).toList();
        var stickers = repository.selectedStickers(readable, true);
        var items = comments.stream().map(c -> project(c, viewer, !readable.contains(c.id()),
                stickers.getOrDefault(c.id(), List.of()))).toList();
        long total = repository.commentCount(post);
        return new Page<>(items, page, size, total, offset + items.size() < total);
    }

    /** 같은 회원도 한 글에 여러 댓글을 남길 수 있습니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Comment createComment(long post, long member, CommentDraft input) {
        repository.lockMember(member); repository.lockPost(post);
        var parent = publishedPost(post, member);
        validateComment(input, parent.bookId());
        long id = repository.insertComment(post, parent.bookId(), member, input);
        repository.replaceStickers(id, input.stickerIds(), true);
        return project(repository.comment(id).orElseThrow(CommunityService::notFound), member, true);
    }

    /** 본인 댓글만 수정하고 생성 시각과 부모 글을 유지합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Comment updateComment(long id, long member, CommentDraft input) {
        repository.lockMember(member);
        var old = repository.comment(id).orElseThrow(CommunityService::notFound);
        repository.lockPost(old.postId());
        var parent = publishedPost(old.postId(), member);
        if (old.memberId() != member) throw notFound();
        validateComment(input, parent.bookId());
        repository.updateComment(id, input);
        repository.replaceStickers(id, input.stickerIds(), true);
        return project(repository.comment(id).orElseThrow(CommunityService::notFound), member, true);
    }

    /** 본인 댓글과 연결 스티커를 실제 삭제합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void deleteComment(long id, long member) {
        repository.lockMember(member);
        var old = repository.comment(id).orElseThrow(CommunityService::notFound);
        repository.lockPost(old.postId()); publishedPost(old.postId(), member);
        if (old.memberId() != member) throw notFound();
        repository.deleteComment(id);
    }

    private void validateComment(CommentDraft input, Long book) {
        if (input.body() == null && input.stickerIds().isEmpty()) throw invalid("댓글 내용이나 이모티콘을 입력해 주세요.");
        validateSpoiler(input.spoilerChapterId(), book); validateStickers(input.stickerIds());
    }

    private void validateSpoiler(Long chapter, Long book) {
        if (chapter != null && (book == null || !repository.publishedChapter(chapter, book)))
            throw invalid("연결 작품의 공개된 회차를 선택해 주세요.");
    }

    private void validateStickers(List<Long> selected) {
        var available = repository.stickers().stream().map(s -> Long.valueOf(s.id())).toList();
        if (!available.containsAll(selected)) throw invalid("사용할 수 없는 이모티콘입니다.");
    }

    /** 다른 회원의 공개 글에 공감 상태를 멱등하게 적용합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public LikeState like(long id, long member, boolean liked) {
        repository.lockMember(member); repository.lockPost(id);
        requireOther(publishedPost(id, member), member);
        repository.like(id, member, liked);
        return new LikeState(liked, repository.post(id, member).orElseThrow(CommunityService::notFound).likeCount());
    }

    /** 중복 신고는 최초 사유를 보존하고 기존 접수 식별자를 반환합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReportResult report(long id, long member, String reason, String detail) {
        repository.lockMember(member); repository.lockPost(id);
        requireOther(publishedPost(id, member), member);
        var existing = repository.report(id, member);
        if (existing.isPresent()) return new ReportResult(new Report(existing.get().toString(), true), false);
        return new ReportResult(new Report(Long.toString(repository.insertReport(id, member, reason, detail)), true), true);
    }

    private void requireOther(CommunityRepository.PostData post, long member) {
        if (post.memberId() == member) throw invalid("본인의 글에는 공감하거나 신고할 수 없습니다.");
    }

    /** 업로드를 실제 PNG로 검증하여 회원 소유 디렉터리에 저장합니다. */
    public ImageInput upload(long member, String encoded, String mime) throws IOException { return images.upload(member, encoded, mime); }

    /** 공개 글에 쓰인 이미지와 본인 업로드만 읽으며 미확인 스포일러를 가립니다. */
    @Transactional(readOnly = true)
    public byte[] image(long owner, String name, Long viewer, boolean reveal) throws IOException {
        String canonical = images.canonical(owner, name);
        if (!Objects.equals(viewer, owner) && !repository.publicImage(canonical, reveal)) throw notFound();
        return images.read(owner, name);
    }

    private CommunityRepository.PostData ownedPost(long id, long member) {
        var post = repository.post(id, member).orElseThrow(CommunityService::notFound);
        if (post.memberId() != member) throw notFound();
        return post;
    }

    private CommunityRepository.PostData readablePost(long id, Long viewer) {
        var post = repository.post(id, viewer).orElseThrow(CommunityService::notFound);
        boolean ownHidden = Objects.equals(viewer, post.memberId()) && "HIDDEN".equals(post.status());
        if (!post.visible() || !("PUBLISHED".equals(post.status()) || ownHidden)) throw notFound();
        return post;
    }

    private CommunityRepository.PostData publishedPost(long id, Long viewer) {
        var post = readablePost(id, viewer);
        if (!"PUBLISHED".equals(post.status())) throw notFound();
        return post;
    }

    private Post project(CommunityRepository.PostData p, Long viewer, boolean reveal) {
        boolean locked = locked(p.hasSpoiler(), p.memberId(), viewer, reveal);
        return project(p, viewer, locked, locked ? List.of() : repository.images(p.id()),
                locked ? List.of() : repository.selectedStickers(p.id(), false));
    }

    private Post project(CommunityRepository.PostData p, Long viewer, boolean locked,
                         List<CommunityRepository.SavedImage> savedImages, List<Sticker> stickers) {
        var attachments = savedImages.stream().map(image ->
                new Image(images.displayUrl(image.url(), !"PUBLISHED".equals(p.status()), p.hasSpoiler()),
                        image.width(), image.height(), image.representative())).toList();
        return new Post(Long.toString(p.id()), Long.toString(p.boardId()), lower(p.boardType()), p.boardName(), p.work(),
                p.head(), locked ? null : p.title(), locked ? null : p.body(), p.nickname(), p.createdAt(), p.updatedAt(),
                p.publishedAt(), p.status(), p.spoiler(), p.hasSpoiler(), locked, Objects.equals(viewer, p.memberId()),
                p.liked(), p.reported(), p.likeCount(), p.commentCount(), attachments, stickers);
    }

    private Comment project(CommunityRepository.CommentData c, Long viewer, boolean reveal) {
        boolean locked = locked(c.hasSpoiler(), c.memberId(), viewer, reveal);
        return project(c, viewer, locked, locked ? List.of() : repository.selectedStickers(c.id(), true));
    }

    private Comment project(CommunityRepository.CommentData c, Long viewer, boolean locked, List<Sticker> stickers) {
        return new Comment(Long.toString(c.id()), Long.toString(c.postId()), locked ? null : c.body(), c.nickname(),
                c.createdAt(), c.updatedAt(), c.spoiler(), c.hasSpoiler(), locked, Objects.equals(viewer, c.memberId()),
                stickers);
    }

    private static boolean locked(boolean hasSpoiler, long owner, Long viewer, boolean reveal) {
        return hasSpoiler && !Objects.equals(owner, viewer) && !reveal;
    }

    private static String lower(String type) { return type.toLowerCase(Locale.ROOT); }
    private BoardResult boardResult(CommunityRepository.BoardData board, boolean created) {
        var latest = created ? null : repository.latestPosts(List.of(board.id())).get(board.id());
        return new BoardResult(project(board, latest), created);
    }
    private static Board project(CommunityRepository.BoardData board, LatestPost latest) {
        return new Board(Long.toString(board.id()), lower(board.type()), board.name(), board.work(), heads(board.type()), latest);
    }
    static List<String> heads(String type) {
        return switch (type) {
            case "WORK" -> List.of("IMPRESSION", "QUESTION", "THEORY", "FREE");
            case "TOPIC" -> List.of("STORY", "QUESTION");
            case "PROMOTION" -> List.of("PROMOTION");
            default -> throw invalid("게시판 종류가 올바르지 않습니다.");
        };
    }

    static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "삭제되었거나 공개되지 않은 자료입니다."); }
    static ResponseStatusException invalid(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    static ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."); }
}
