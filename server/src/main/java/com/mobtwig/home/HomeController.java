package com.mobtwig.home;

import java.io.IOException;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 홈 SDUI의 공개 HTTP 조회 요청을 처리합니다. */
@RestController
@CrossOrigin(origins = "*")
public class HomeController {
    private final HomeService homeService;

    /**
     * 홈 구성 서비스를 주입받습니다.
     * @param homeService 홈 응답 서비스입니다.
     */
    public HomeController(HomeService homeService) {
        this.homeService = homeService;
    }

    /**
     * 분류에 해당하는 홈을 반환합니다.
     * @param kinds 요청의 kind 값 목록입니다.
     * @return 분류에 해당하는 홈 SDUI입니다.
     * @throws ResponseStatusException kind가 중복되었거나 잘못되면 발생합니다.
     * @throws IOException 홈 구성 파일을 읽지 못하면 발생합니다.
     */
    @GetMapping("/sdui/home")
    public HomeResponse getHome(@RequestParam("kind") List<String> kinds) throws IOException {
        if (kinds.size() != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "kind를 한 개 지정해야 합니다.");
        }
        return homeService.getHome(kinds.getFirst());
    }
}
