package com.mobtwig.purchase;

import java.security.Principal;
import java.util.List;
import com.mobtwig.reader.ChapterTextResponse;
import com.mobtwig.reader.ChapterTextService;
import com.mobtwig.reader.MagazineService;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

/** /api 경로의 기존 회원 쿠키로 인증하고 소장 권한을 확인한 본문을 제공합니다. */
@RestController
@RequestMapping("/api/members/works/{slug}")
public class PurchasedContentController {
    private final PurchaseService purchases;
    private final ChapterTextService text;
    private final MagazineService magazine;

    /**
     * 구매 권한과 기존 본문 공급자를 주입받습니다.
     * @param purchases 소장 권한 검사기입니다.
     * @param text 기존 텍스트 본문 공급자입니다.
     * @param magazine 기존 매거진 본문 공급자입니다.
     */
    public PurchasedContentController(PurchaseService purchases, ChapterTextService text, MagazineService magazine) {
        this.purchases = purchases; this.text = text; this.magazine = magazine;
    }

    /**
     * 무료 회차 또는 회원이 소장한 작품·회차의 본문을 제공합니다.
     * @param slug 작품 slug입니다.
     * @param chapterId 공개된 회차 ID입니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 기존 공개 텍스트 API와 같은 본문 형식입니다.
     */
    @GetMapping("/chapters/{chapterId}")
    public ResponseEntity<ChapterTextResponse> text(@PathVariable String slug, @PathVariable String chapterId, Principal principal) {
        purchases.requireRead(Long.parseLong(principal.getName()), slug, PurchaseController.decimal(chapterId, true));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(text.read(slug, chapterId));
    }

    /**
     * 본문이 포함되지 않은 공개 호·기사 목록을 제공합니다.
     * @param slug 매거진 slug입니다.
     * @return 기존 공개 매거진 API와 같은 호 정보입니다.
     */
    @GetMapping("/magazine")
    public ResponseEntity<MagazineService.Issue> magazine(@PathVariable String slug) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(magazine.read(slug));
    }

    /**
     * 소장 권한을 확인한 뒤 기존 파일·버전 검사로 PNG를 제공합니다.
     * @param slug 매거진 slug입니다.
     * @param pageNumber 호 기준 양의 쪽 번호입니다.
     * @param parameters contentVersion을 한 번 지정합니다.
     * @param principal 인증된 현재 회원입니다.
     * @return 현재 버전의 매거진 PNG입니다.
     */
    @GetMapping("/magazine/pages/{pageNumber}")
    public ResponseEntity<byte[]> page(@PathVariable String slug, @PathVariable String pageNumber,
            @RequestParam MultiValueMap<String, String> parameters, Principal principal) {
        List<String> versions = parameters.get("contentVersion");
        if (versions == null || versions.size() != 1) throw PurchaseFailure.invalid();
        purchases.requireRead(Long.parseLong(principal.getName()), slug, null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG)
                .body(magazine.page(slug, positive(pageNumber), positive(versions.getFirst())));
    }

    private static int positive(String value) {
        long number = PurchaseController.decimal(value, false);
        if (number > Integer.MAX_VALUE) throw PurchaseFailure.invalid();
        return (int) number;
    }
}
