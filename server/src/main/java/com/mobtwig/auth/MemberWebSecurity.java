package com.mobtwig.auth;

import java.util.Arrays;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 공개 가입·회원 CSRF의 보안 영역입니다. 로그인·회원 전용 기능은 #20에서 확장합니다. */
@Configuration(proxyBeanMethods = false)
public class MemberWebSecurity {
    @Bean @Order(1)
    public SecurityFilterChain memberFilter(HttpSecurity http, AuthCookies cookies) throws Exception {
        return http.securityMatcher("/api/auth/**", "/api/members/**")
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/auth/csrf", "/api/auth/signup", "/api/auth/terms").permitAll()
                        .anyRequest().denyAll())
                .addFilterBefore(new AuthScopeGuard(AuthCookies.MEMBER, cookies), SecurityContextHolderFilter.class)
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .requestCache(c -> c.requestCache(new NullRequestCache()))
                .formLogin(AbstractHttpConfigurer::disable).logout(AbstractHttpConfigurer::disable).build();
    }

    /** 와일드카드 없이 인증 경로에만 credential CORS를 적용합니다. 웹 배포는 same-site 구성입니다. */
    @Bean public WebMvcConfigurer memberCors(@Value("${mobtwig.auth.allowed-origins:}") String origins) {
        var allowed = Arrays.stream(origins.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toArray(String[]::new);
        for (String origin : allowed) {
            var uri = java.net.URI.create(origin);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || !(uri.getPath() == null || uri.getPath().isEmpty()) || origin.contains("*")) {
                throw new IllegalArgumentException("AUTH_ALLOWED_ORIGINS에는 정확한 HTTP(S) origin만 지정하십시오.");
            }
        }
        return new WebMvcConfigurer() {
            @Override public void addCorsMappings(CorsRegistry registry) {
                for (String path : new String[]{"/api/auth/**", "/api/members/**"}) {
                    registry.addMapping(path).allowedOrigins(allowed).allowedMethods("GET", "POST", "OPTIONS")
                            .allowedHeaders("Content-Type", "X-CSRF-TOKEN", "Accept").allowCredentials(true).maxAge(600);
                }
            }
        };
    }
}
