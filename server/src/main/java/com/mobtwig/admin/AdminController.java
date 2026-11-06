package com.mobtwig.admin;

import java.security.Principal;

import jakarta.validation.Valid;
import org.jspecify.annotations.NonNull;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

/** 같은 백엔드 배포물의 관리자 화면과 인증된 등록 API를 제공합니다. */
@RestController
public class AdminController {
    private final AdminAccounts accounts;
    private final AdminCatalog catalog;

    /**
     * 인증 계정과 등록 서비스를 주입받습니다.
     * @param accounts 계정 서비스입니다.
     * @param catalog 콘텐츠 등록 서비스입니다.
     */
    public AdminController(AdminAccounts accounts, AdminCatalog catalog) {
        this.accounts = accounts;
        this.catalog = catalog;
    }

    /**
     * 로그인 정보를 포함하지 않는 관리자 화면을 반환합니다.
     * @return 같은 JAR에 포함한 HTML입니다.
     */
    @GetMapping(value = {"/admin", "/admin/"}, produces = MediaType.TEXT_HTML_VALUE)
    public Resource page() { return new ClassPathResource("static/admin/index.html"); }

    /**
     * 현재 세션의 CSRF 토큰을 반환합니다.
     * @param token Spring Security가 관리하는 토큰입니다.
     * @return 변경 요청에 사용할 토큰입니다.
     */
    @GetMapping("/api/admin/csrf")
    public CsrfToken csrf(CsrfToken token) { return token; }

    /**
     * 현재 로그인한 관리자를 반환합니다.
     * @param principal 인증된 회원 ID입니다.
     * @return 비밀번호가 없는 계정 정보입니다.
     */
    @GetMapping("/api/admin/session")
    public AdminAccounts.Session session(Principal principal) { return accounts.session(principal.getName()); }

    /**
     * DB의 현재 등록 자료를 반환합니다.
     * @return 선택할 관계와 작품 목록입니다.
     */
    @GetMapping("/api/admin/catalog")
    public AdminCatalog.Catalog catalog() { return catalog.catalog(); }

    /**
     * 허용 팀원에게 계정을 발급합니다.
     * @param input 새 계정 정보입니다.
     * @return 새 회원 ID입니다.
     */
    @PostMapping("/api/admin/accounts") @ResponseStatus(HttpStatus.CREATED)
    public Id account(@Valid @RequestBody AdminRequests.Account input) { return new Id(accounts.create(input)); }

    /**
     * 저자를 등록합니다.
     * @param input 저자 정보입니다.
     * @return 생성한 ID입니다.
     */
    @PostMapping("/api/admin/authors") @ResponseStatus(HttpStatus.CREATED)
    public Id author(@Valid @RequestBody AdminRequests.Author input) { return new Id(catalog.author(input)); }

    /**
     * 장르를 등록합니다.
     * @param input 장르 정보입니다.
     * @return 생성한 ID입니다.
     */
    @PostMapping("/api/admin/genres") @ResponseStatus(HttpStatus.CREATED)
    public Id genre(@Valid @RequestBody AdminRequests.Genre input) { return new Id(catalog.genre(input)); }

    /**
     * 카테고리를 등록합니다.
     * @param input 카테고리 정보입니다.
     * @return 생성한 ID입니다.
     */
    @PostMapping("/api/admin/categories") @ResponseStatus(HttpStatus.CREATED)
    public Id category(@Valid @RequestBody AdminRequests.Category input) { return new Id(catalog.category(input)); }

    /**
     * 작품과 관계·회차를 등록합니다.
     * @param input 공개 계약을 충족하는 작품입니다.
     * @return DB ID와 공개 URL 식별자입니다.
     */
    @PostMapping("/api/admin/works") @ResponseStatus(HttpStatus.CREATED)
    public CreatedWork work(@Valid @RequestBody AdminRequests.Work input) {
        return new CreatedWork(catalog.work(input), input.slug());
    }

    /**
     * 작품에 회차를 추가합니다.
     * @param id 작품 DB ID입니다.
     * @param input 새 회차입니다.
     * @return 생성한 회차 ID입니다.
     */
    @PostMapping("/api/admin/works/{id}/chapters") @ResponseStatus(HttpStatus.CREATED)
    public Id chapter(@PathVariable long id, @Valid @RequestBody AdminRequests.@NonNull Chapter input) {
        return new Id(catalog.chapter(id, input));
    }

    /**
     * 작품을 공개하거나 숨깁니다.
     * @param id 작품 DB ID입니다.
     * @param input 공개 상태입니다.
     */
    @PostMapping("/api/admin/works/{id}/status") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void status(@PathVariable long id, @Valid @RequestBody AdminRequests.Status input) {
        catalog.status(id, input.publishStatus());
    }

    /**
     * 등록한 식별자입니다.
     * @param id DB ID입니다.
     */
    public record Id(long id) { }

    /**
     * 등록한 작품 식별자입니다.
     * @param id DB ID입니다.
     * @param slug 공개 URL 식별자입니다.
     */
    public record CreatedWork(long id, String slug) { }
}
