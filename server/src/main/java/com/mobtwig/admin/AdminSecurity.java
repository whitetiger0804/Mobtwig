package com.mobtwig.admin;

import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.savedrequest.NullRequestCache;

/** 관리자 API에 DB 계정 인증, 세션과 CSRF 보호를 적용합니다. */
@Configuration(proxyBeanMethods = false)
public class AdminSecurity {
    /** 기본 보안 구성을 생성합니다. */
    public AdminSecurity() { }

    /**
     * 관리자 API만 보호하고 기존 공개 조회와 readiness를 유지합니다.
     * @param http HTTP 보안 구성기입니다.
     * @param accounts 매 요청의 현재 관리자 권한을 확인합니다.
     * @return 세션·CSRF 기반 보안 필터입니다.
     * @throws Exception 보안 필터를 구성하지 못하면 발생합니다.
     */
    @Bean
    public SecurityFilterChain adminFilter(HttpSecurity http, AdminAccounts accounts) throws Exception {
        return http.cors(Customizer.withDefaults())
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/admin/csrf", "/api/admin/login").permitAll()
                        .requestMatchers("/api/admin/**").access((authentication, context) -> {
                            var principal = authentication.get();
                            return new AuthorizationDecision(principal != null && principal.isAuthenticated()
                                    && !(principal instanceof AnonymousAuthenticationToken)
                                    && accounts.isAdmin(principal.getName()));
                        })
                        .anyRequest().permitAll())
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .requestCache(cache -> cache.requestCache(new NullRequestCache()))
                .formLogin(login -> login.loginPage("/admin").loginProcessingUrl("/api/admin/login")
                        .successHandler((request, response, authentication) -> response.setStatus(204))
                        .failureHandler((request, response, exception) -> response.setStatus(401)))
                .logout(logout -> logout.logoutUrl("/api/admin/logout")
                        .logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)))
                .headers(headers -> headers.contentSecurityPolicy(policy -> policy
                        .policyDirectives("default-src 'self'; img-src 'self' https:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"))
                        .addHeaderWriter((request, response) -> {
                            // Swagger UI 문서의 내장 SVG 이미지에만 data 주소를 허용합니다.
                            if ("/api-docs/index.html".equals(request.getServletPath())) {
                                response.setHeader("Content-Security-Policy",
                                        "default-src 'self'; img-src 'self' https: data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
                            }
                        }))
                .build();
    }

    /**
     * 평문 비밀번호 저장 없이 BCrypt를 사용합니다.
     * @return 계정 생성과 로그인에 공통으로 사용할 처리기입니다.
     */
    @Bean
    public PasswordEncoder passwords() {
        return new BCryptPasswordEncoder(12);
    }
}
