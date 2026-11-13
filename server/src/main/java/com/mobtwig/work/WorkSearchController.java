package com.mobtwig.work;

import java.util.List;
import org.jspecify.annotations.NonNull;
import org.springframework.http.HttpStatus;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 로그인 없이 공개 작품의 제목·저자·출판사를 검색합니다. */
@RestController
@CrossOrigin(origins = "*")
public class WorkSearchController {
    private final WorkSearchService search;

    /**
     * 공개 작품 검색 서비스를 주입받습니다.
     * @param search 검색 조건과 응답을 처리하는 서비스입니다.
     */
    public WorkSearchController(WorkSearchService search) {
        this.search = search;
    }

    /**
     * 검색어와 선택한 콘텐츠 종류에 맞는 공개 작품을 반환합니다.
     * @param parameters 검색어 query와 선택적인 종류 kind입니다. 각 값은 한 번만 지정합니다.
     * @return 검색 결과이며 결과가 없으면 빈 목록입니다.
     * @throws ResponseStatusException 검색 조건이 중복되거나 올바르지 않으면 발생합니다.
     */
    @GetMapping("/works")
    public List<@NonNull WorkSearchResponse> search(@RequestParam MultiValueMap<String, String> parameters) {
        List<String> queries = parameters.get("query");
        List<String> kinds = parameters.get("kind");
        if (queries == null || queries.size() != 1 || kinds != null && kinds.size() != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "검색어와 종류는 각각 한 번만 지정하십시오.");
        }
        return search.search(queries.getFirst(), kinds == null ? "all" : kinds.getFirst());
    }
}
