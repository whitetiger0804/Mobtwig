package com.mobtwig.purchase;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.NonNull;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** 관리자 상품 설정과 회원 본인의 구매를 제공합니다. */
@RestController
public class PurchaseController {
    private final PurchaseService purchases;

    /**
     * 구매 서비스를 주입받습니다.
     * @param purchases 구매 서비스입니다.
     */
    public PurchaseController(PurchaseService purchases) { this.purchases = purchases; }

    /**
     * 공개 작품의 상품을 조회합니다. 회원 쿠키를 읽지 않으므로 owned는 false입니다.
     * @param slug 작품 slug입니다.
     * @return 현재 공개된 상품의 목록입니다.
     */
    @CrossOrigin(origins = "*")
    @GetMapping("/works/{slug}/purchase-products")
    public ResponseEntity<List<PurchaseResponses.@NonNull Product>> products(@PathVariable String slug) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(purchases.products(null, slug));
    }

    /**
     * 현재 회원의 소장 여부를 포함해 상품을 조회합니다.
     * @param slug 작품 slug입니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 회차 순서의 상품·소장 상태입니다.
     */
    @GetMapping("/api/members/works/{slug}/purchase-products")
    public ResponseEntity<List<PurchaseResponses.@NonNull Product>> memberProducts(@PathVariable String slug, Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(purchases.products(member(principal), slug));
    }

    /**
     * 기존 관리자 세션과 CSRF로 상품 가격을 설정합니다.
     * @param slug 작품 slug입니다.
     * @param body chapterId(null 또는 문자열), price(원)를 모두 지정합니다.
     * @return 생성 또는 갱신한 상품입니다.
     */
    @PostMapping("/api/admin/works/{slug}/purchase-products")
    public ResponseEntity<PurchaseResponses.Product> configure(@PathVariable String slug, @RequestBody JsonNode body) {
        if (!body.isObject() || body.size() != 2) throw PurchaseFailure.invalid();
        var chapter = body.path("chapterId");
        Long id = chapter.isNull() ? null : decimal(chapter, true);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(purchases.configure(slug, id, price(body.path("price"))));
    }

    /**
     * 가격을 확인한 구매를 등록합니다. 회원 ID·결제 성공 여부를 요청으로 받지 않습니다.
     * @param body productId, expectedPrice, UUID requestId를 지정합니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 최초 구매는 201이며 같은 요청의 재시도는 200입니다.
     */
    @PostMapping("/api/members/purchases")
    public ResponseEntity<PurchaseResponses.Purchase> purchase(@RequestBody JsonNode body, Principal principal) {
        if (!body.isObject() || body.size() != 3 || !body.path("requestId").isString()) throw PurchaseFailure.invalid();
        var result = purchases.purchase(member(principal), decimal(body.path("productId"), false),
                price(body.path("expectedPrice")), body.path("requestId").asString());
        return ResponseEntity.status(result.created() ? 201 : 200).cacheControl(CacheControl.noStore()).body(result.purchase());
    }

    /**
     * 구매 당시 정보를 포함한 본인의 전체 내역을 반환합니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 구매 최신순의 배열이며 기록이 없으면 빈 배열입니다.
     */
    @GetMapping("/api/members/purchase-history")
    public ResponseEntity<List<PurchaseResponses.@NonNull Purchase>> history(Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(purchases.history(member(principal)));
    }

    /**
     * 본인의 구매 한 건을 확인합니다. 타인의 ID는 없는 기록과 같이 404입니다.
     * @param purchaseId 구매 ID입니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 구매 당시의 정보입니다.
     */
    @GetMapping("/api/members/purchases/{purchaseId}")
    public ResponseEntity<PurchaseResponses.Purchase> read(@PathVariable String purchaseId, Principal principal) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(purchases.read(member(principal), decimal(purchaseId, false)));
    }

    /**
     * 입력·가격·소장 오류를 SQL이나 원본 요청 없이 반환합니다.
     * @param failure 검증된 구매 오류입니다.
     * @return HTTP 상태와 고정 코드·안내입니다.
     */
    @ExceptionHandler(PurchaseFailure.class)
    public ResponseEntity<Map<String, @NonNull String>> rejected(PurchaseFailure failure) {
        if (failure.getStatusCode().value() == 401) return ResponseEntity.status(401).cacheControl(CacheControl.noStore()).build();
        return ResponseEntity.status(failure.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("code", failure.code(), "message", java.util.Objects.requireNonNull(failure.getReason())));
    }

    /**
     * JSON 문법 오류를 입력 오류로 반환합니다.
     * @return JSON 문법 오류에 대한 400 응답입니다.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, @NonNull String>> malformed() { return rejected(PurchaseFailure.invalid()); }

    /**
     * 저장·메타데이터 처리 실패를 내부 원문 없이 반환합니다.
     * @return DB 원문·로컬 경로를 제외한 500 응답입니다.
     */
    @ExceptionHandler({DataAccessException.class, IllegalStateException.class, IllegalArgumentException.class})
    public ResponseEntity<Map<String, String>> failed() {
        return ResponseEntity.internalServerError().cacheControl(CacheControl.noStore())
                .body(Map.of("code", "UNAVAILABLE", "message", "구매 정보를 처리하지 못했습니다. 다시 시도하십시오."));
    }

    private static long member(Principal principal) { return Long.parseLong(principal.getName()); }

    private static int price(JsonNode value) {
        if (!value.isIntegralNumber() || !value.canConvertToInt()) throw PurchaseFailure.invalid();
        return value.asInt();
    }

    private static long decimal(JsonNode value, boolean signed) {
        if (!value.isString()) throw PurchaseFailure.invalid();
        return decimal(value.asString(), signed);
    }

    static long decimal(String value, boolean signed) {
        if (!value.matches(signed ? "-?[1-9][0-9]{0,18}" : "[1-9][0-9]{0,18}")) throw PurchaseFailure.invalid();
        try { return Long.parseLong(value); }
        catch (NumberFormatException invalid) { throw PurchaseFailure.invalid(); }
    }
}
