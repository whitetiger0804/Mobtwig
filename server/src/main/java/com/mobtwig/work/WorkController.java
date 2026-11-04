package com.mobtwig.work;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** 공개 작품 상세의 HTTP 조회 요청을 처리합니다. */
@RestController
@CrossOrigin(origins = "*")
public class WorkController {
    private final WorkService workService;

    /**
     * 작품 상세 서비스를 주입받습니다.
     * @param workService 작품 상세 조회 서비스입니다.
     */
    public WorkController(WorkService workService) {
        this.workService = workService;
    }

    /**
     * URL 식별자에 해당하는 공개 작품을 반환합니다.
     * @param slug 작품 URL 식별자입니다.
     * @return 클라이언트의 작품 상세 응답입니다.
     */
    @GetMapping("/works/{slug}")
    public WorkDetailResponse getDetail(@PathVariable("slug") String slug) {
        return workService.getPublishedDetail(slug);
    }
}
