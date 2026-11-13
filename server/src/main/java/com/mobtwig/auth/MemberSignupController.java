package com.mobtwig.auth;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 시연 문서 조회와 CSRF가 적용된 가입 API입니다. */
@RestController
@RequestMapping("/api/auth")
public class MemberSignupController {
    private final SignupPolicies policies;
    private final MemberSignupService signup;

    public MemberSignupController(SignupPolicies policies, MemberSignupService signup) {
        this.policies = policies;
        this.signup = signup;
    }

    @GetMapping("/terms")
    public ResponseEntity<Terms> terms() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Terms(policies.current()));
    }

    @PostMapping(value = "/signup", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<MemberSignupService.Created> signup(@RequestBody Map<String, Object> input, Principal principal) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(signup.register(input, principal != null));
    }

    @ExceptionHandler(SignupFailure.class)
    ResponseEntity<ErrorBody> failure(SignupFailure failure) {
        return ResponseEntity.status(failure.status).cacheControl(CacheControl.noStore())
                .body(new ErrorBody(failure.getMessage(), failure.fields));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorBody> malformed() {
        return failure(SignupFailure.invalid(Map.of("request", "가입 정보의 JSON 형식을 확인해 주세요.")));
    }

    public record Terms(List<SignupPolicies.Document> documents) { }
    public record ErrorBody(String message, Map<String, String> fieldErrors) { }
}
