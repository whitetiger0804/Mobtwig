package com.mobtwig.share;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** 공개 공유 주소에 같은 origin의 정적 작품 안내를 제공합니다. */
@RestController
public class ShareLandingController {
    /**
     * 사용자 값을 HTML에 삽입하지 않고 고정 안내 문서를 제공합니다.
     * @param slug 공개 작품의 문자열 식별자입니다.
     * @return 작품 상세를 한 번 조회하는 정적 안내 문서입니다.
     */
    @GetMapping("/s/works/{slug:[a-z0-9-]{1,120}}")
    public ResponseEntity<Resource> page(@PathVariable String slug) {
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).cacheControl(CacheControl.noStore())
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; "
                        + "connect-src 'self'; img-src 'self' https: http:; font-src 'self'; "
                        + "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
                .header("Referrer-Policy", "no-referrer")
                .body(new ClassPathResource("static/share/index.html"));
    }
}
