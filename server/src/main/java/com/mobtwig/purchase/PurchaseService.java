package com.mobtwig.purchase;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import com.mobtwig.purchase.PurchaseRepository.Chapter;
import com.mobtwig.purchase.PurchaseRepository.Product;
import com.mobtwig.purchase.PurchaseRepository.Stored;
import com.mobtwig.purchase.PurchaseRepository.Work;
import com.mobtwig.work.WorkMetadata;
import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 구매 기록과 소장 권한을 원자적으로 처리합니다. */
@Service
public class PurchaseService {
    private final PurchaseRepository repository;

    /**
     * 상품·구매 저장소를 주입받습니다.
     * @param repository 상품·구매·소장 권한 저장소입니다.
     */
    public PurchaseService(PurchaseRepository repository) { this.repository = repository; }

    /**
     * 도서·매거진의 작품 상품 또는 웹소설의 회차 상품을 설정합니다.
     * @param slug 작품 slug입니다.
     * @param chapterId 웹소설 회차 ID이며 작품 전체는 null입니다.
     * @param price 0 이상의 가격입니다.
     * @return 설정한 상품이며 기존 구매 가격·권한은 변경하지 않습니다.
     */
    @Transactional
    public PurchaseResponses.Product configure(String slug, @Nullable Long chapterId, int price) {
        validateSlug(slug);
        if (price < 0) throw PurchaseFailure.invalid();
        Work work = repository.work(slug, true).orElseThrow(PurchaseFailure::notFound);
        if (work.type().equals("WEBNOVEL") != (chapterId != null)) {
            throw new PurchaseFailure(HttpStatus.BAD_REQUEST, "INVALID_TARGET", "도서·매거진은 작품 전체, 웹소설은 회차별로 상품을 설정하십시오.");
        }
        Chapter chapter = chapterId == null ? null : repository.chapter(work.id(), chapterId, true).orElseThrow(PurchaseFailure::notFound);
        Product product = repository.configure(work.id(), chapterId, price);
        return product(work, product, chapter == null ? null : chapter.title(), false);
    }

    /**
     * 공개 작품의 상품을 조회합니다. 회원 ID는 인증에서만 얻습니다.
     * @param member 비회원이면 null입니다.
     * @param slug 작품 slug입니다.
     * @return 공개된 회차 순서의 상품이며 상품 미설정은 빈 목록입니다.
     */
    @Transactional(readOnly = true)
    public List<PurchaseResponses.@NonNull Product> products(@Nullable Long member, String slug) {
        Work work = repository.work(slug, false).filter(w -> w.status().equals("PUBLISHED")).orElseThrow(PurchaseFailure::notFound);
        return repository.products(work.id(), member).stream()
                .map(offer -> product(work, offer.product(), offer.chapterTitle(), offer.owned())).toList();
    }

    /**
     * 서버 가격을 확인한 구매와 서재 등록을 같은 트랜잭션에서 수행합니다.
     * @param member 현재 활성 회원입니다.
     * @param productId 상품 ID입니다.
     * @param expectedPrice 사용자가 확인한 가격입니다.
     * @param requestId 같은 구매 재시도에 재사용할 UUID입니다. 새 구매에는 새 UUID를 사용합니다.
     * @return 최초 생성 여부와 구매 기록입니다. 같은 요청 재시도는 원래 기록을 반환합니다.
     */
    @Transactional
    public Result purchase(long member, long productId, int expectedPrice, String requestId) {
        if (expectedPrice < 0 || !requestId.matches("[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")) throw PurchaseFailure.invalid();
        String key = UUID.fromString(requestId).toString();
        lockMember(member);
        var previous = repository.byRequest(member, key);
        if (previous.isPresent()) {
            Stored saved = previous.get();
            if (saved.product() != productId || saved.price() != expectedPrice) {
                throw new PurchaseFailure(HttpStatus.CONFLICT, "REQUEST_CONFLICT", "같은 requestId를 다른 구매에 재사용할 수 없습니다.");
            }
            return new Result(response(saved), false);
        }
        Product selected = repository.product(productId, false).orElseThrow(PurchaseFailure::notFound);
        Work work = repository.work(selected.book()).filter(w -> w.status().equals("PUBLISHED")).orElseThrow(PurchaseFailure::notFound);
        // 관리자 상품 설정과 같은 작품 → 상품 순서로 잠급니다.
        Product product = repository.product(productId, true).orElseThrow(PurchaseFailure::notFound);
        Long chapterId = product.chapter();
        Chapter chapter = chapterId == null ? null : repository.chapter(work.id(), chapterId, true).orElseThrow(PurchaseFailure::notFound);
        if (chapter != null) {
            Instant published = chapter.publishedAt();
            if (published == null || published.isAfter(Instant.now())) throw PurchaseFailure.notFound();
        }
        if (product.price() != expectedPrice) throw new PurchaseFailure(HttpStatus.CONFLICT, "PRICE_CHANGED", "상품 가격이 변경되었습니다. 다시 확인하십시오.");
        if (repository.owned(member, product.id())) throw new PurchaseFailure(HttpStatus.CONFLICT, "ALREADY_OWNED", "이미 소장한 상품입니다.");
        WorkMetadata.slug(work.slug());
        WorkMetadata.requiredText(work.title(), "제목");
        WorkMetadata.imageUrl(work.image());
        if (chapter != null) WorkMetadata.requiredText(chapter.title(), "회차 제목");
        Stored saved = repository.insert(member, product, work, chapter, key);
        repository.addToLibrary(member, work.id());
        return new Result(response(saved), true);
    }

    /**
     * 회원 본인의 구매 이력을 구매 최신순으로 모두 조회합니다.
     * @param member 인증된 회원 ID입니다.
     * @return 구매 시점의 정보를 보존한 목록이며 기록이 없으면 빈 목록입니다.
     */
    @Transactional(readOnly = true)
    public List<PurchaseResponses.@NonNull Purchase> history(long member) {
        return repository.history(member).stream().map(PurchaseService::response).toList();
    }

    /**
     * 본인의 구매 한 건을 조회합니다.
     * @param member 현재 회원입니다.
     * @param id 본인의 구매 ID입니다.
     * @return 해당 구매 기록입니다.
     */
    @Transactional(readOnly = true)
    public PurchaseResponses.Purchase read(long member, long id) {
        return response(repository.purchase(member, id).orElseThrow(PurchaseFailure::notFound));
    }

    /**
     * 실제 본문·쪽 또는 새 독서 기록에 접근하기 전에 소장 권한을 검사합니다.
     * @param member 비회원이면 null입니다.
     * @param book 작품 DB ID입니다.
     * @param chapter 회차 ID이며 매거진 전체 쪽 검사는 null입니다.
     */
    public void requireRead(@Nullable Long member, long book, @Nullable Long chapter) {
        if (!repository.readable(member, book, chapter)) {
            throw new PurchaseFailure(member == null ? HttpStatus.UNAUTHORIZED : HttpStatus.PAYMENT_REQUIRED,
                    "PURCHASE_REQUIRED", "구매 후 열람할 수 있는 콘텐츠입니다.");
        }
    }

    /**
     * 공개 본문 경로의 작품과 회차를 확인하고 구매 우회를 차단합니다.
     * @param member 현재 회원이며 공개 경로에서는 null입니다.
     * @param slug 작품 slug입니다.
     * @param chapterId 텍스트 회차 ID이며 매거진 쪽은 null입니다.
     */
    @Transactional(readOnly = true)
    public void requireRead(@Nullable Long member, String slug, @Nullable Long chapterId) {
        Work work = repository.work(slug, false).filter(w -> w.status().equals("PUBLISHED")).orElseThrow(PurchaseFailure::notFound);
        if (chapterId != null) {
            Chapter chapter = repository.chapter(work.id(), chapterId, false).orElseThrow(PurchaseFailure::notFound);
            Instant published = chapter.publishedAt();
            if (published == null || published.isAfter(Instant.now())) throw PurchaseFailure.notFound();
        }
        requireRead(member, work.id(), chapterId);
    }

    private void lockMember(long member) {
        if (!repository.lockMember(member)) throw new PurchaseFailure(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "활성 회원 세션이 필요합니다.");
    }

    private static void validateSlug(String slug) {
        if (!slug.matches("[a-z0-9-]{1,120}")) throw PurchaseFailure.invalid();
    }

    private static PurchaseResponses.@NonNull Product product(Work work, Product product, @Nullable String chapterTitle, boolean owned) {
        Long chapter = product.chapter();
        return new PurchaseResponses.Product(Long.toString(product.id()), WorkMetadata.slug(work.slug()), WorkMetadata.kind(work.type()),
                WorkMetadata.requiredText(work.title(), "제목"), WorkMetadata.imageUrl(work.image()),
                chapter == null ? null : chapter.toString(), chapter == null ? null : WorkMetadata.requiredText(Objects.requireNonNull(chapterTitle), "회차 제목"),
                product.price(), "KRW", owned, product.price() == 0 || owned, "DEMO");
    }

    private static PurchaseResponses.@NonNull Purchase response(Stored saved) {
        Long chapter = saved.chapter();
        return new PurchaseResponses.Purchase(Long.toString(saved.id()), Long.toString(saved.product()), saved.slug(), WorkMetadata.kind(saved.type()),
                saved.title(), saved.image(), saved.purchasedAt().toString(), chapter == null ? null : chapter.toString(), saved.chapterTitle(),
                saved.price(), "KRW", "DEMO");
    }

    /**
     * 최초 구매 생성과 재시도를 HTTP 응답 상태에서 구분합니다.
     * @param purchase 완료한 구매 기록입니다.
     * @param created 최초 생성이면 true이며 동일 요청 재시도는 false입니다.
     */
    public record Result(PurchaseResponses.Purchase purchase, boolean created) { }
}
