package com.mobtwig.auth;

import java.util.Arrays;
import java.util.List;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandlerImpl;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/** 관리자와 격리된 회원 CSRF·로그인·로그아웃·활성 회원 접근을 구성합니다. */
@Configuration(proxyBeanMethods = false)
public class MemberWebSecurity {
    @Bean @Order(1)
    public SecurityFilterChain memberFilter(HttpSecurity http, AuthCookies cookies, MemberSessions sessions,
            @Qualifier("memberCors") CorsConfigurationSource cors) throws Exception {
        var contentWrite = new OrRequestMatcher(
                PathPatternRequestMatcher.withDefaults().matcher("/api/members/works/{slug}/reviews"),
                PathPatternRequestMatcher.withDefaults().matcher("/api/members/reviews/**"),
                PathPatternRequestMatcher.withDefaults().matcher("/api/members/review-comments/**"),
                PathPatternRequestMatcher.withDefaults().matcher("/api/members/community/**"));
        var defaultDenied = new AccessDeniedHandlerImpl();
        return http.securityMatcher("/api/auth/**", "/api/members/**")
                .cors(configuration -> configuration.configurationSource(cors))
                .authorizeHttpRequests(auth -> auth.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/auth/csrf", "/api/auth/signup", "/api/auth/terms", "/api/auth/login").permitAll()
                        .anyRequest().authenticated())
                // 허용 origin의 영역 오류도 읽을 수 있게 CORS 뒤·CSRF 앞에서 검사합니다.
                .addFilterBefore(new AuthScopeGuard(AuthCookies.MEMBER, cookies), CsrfFilter.class)
                .addFilterBefore(new ActiveMemberGuard(sessions, cookies), AuthorizationFilter.class)
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
                        .accessDeniedHandler((request, response, failure) -> {
                            if (!contentWrite.matches(request)) {
                                defaultDenied.handle(request, response, failure);
                                return;
                            }
                            // CSRF 실패가 먼저 발생해도 리뷰·커뮤니티 요청의 미인증은 401로 반환합니다.
                            var auth = SecurityContextHolder.getContext().getAuthentication();
                            boolean active = auth != null && auth.isAuthenticated() && !(auth instanceof AnonymousAuthenticationToken)
                                    && sessions.current(auth.getName()).isPresent();
                            response.setHeader("Cache-Control", "no-store");
                            response.setStatus(active ? 403 : 401);
                        }))
                .requestCache(c -> c.requestCache(new NullRequestCache()))
                .formLogin(login -> login.loginPage("/api/auth/login").loginProcessingUrl("/api/auth/login")
                        .usernameParameter("email")
                        .successHandler((request, response, authentication) -> {
                            request.getSession().setAttribute(AuthCookies.SCOPE, AuthCookies.MEMBER);
                            request.getSession().setMaxInactiveInterval(cookies.memberSessionTimeoutSeconds());
                            response.setHeader("Cache-Control", "no-store"); response.setStatus(204);
                        })
                        .failureHandler((request, response, exception) -> { response.setHeader("Cache-Control", "no-store"); response.setStatus(401); }))
                .logout(logout -> logout.logoutUrl("/api/auth/logout")
                        .logoutSuccessHandler((request, response, authentication) -> {
                            cookies.expireSession(request, response);
                            response.setHeader("Cache-Control", "no-store"); response.setStatus(204);
                        })).build();
    }

    /** 회원 인증 경로의 오류 응답에도 동일한 credential CORS 정책을 적용합니다. */
    @Bean public UrlBasedCorsConfigurationSource memberCors(@Value("${mobtwig.auth.allowed-origins:}") String origins) {
        var allowed = Arrays.stream(origins.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toList();
        for (String origin : allowed) {
            var uri = java.net.URI.create(origin);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || !(uri.getPath() == null || uri.getPath().isEmpty()) || origin.contains("*")) {
                throw new IllegalArgumentException("AUTH_ALLOWED_ORIGINS에는 정확한 HTTP(S) origin만 지정하십시오.");
            }
        }
        var source = new UrlBasedCorsConfigurationSource();
        for (String path : new String[]{"/api/auth/**", "/api/members/**"}) {
            var configuration = new CorsConfiguration();
            configuration.setAllowedOrigins(allowed);
            configuration.setAllowedMethods(path.startsWith("/api/members/")
                    ? List.of("GET", "POST", "PUT", "DELETE", "OPTIONS") : List.of("GET", "POST", "OPTIONS"));
            configuration.setAllowedHeaders(List.of("Content-Type", "X-CSRF-TOKEN", "Accept"));
            configuration.setAllowCredentials(true);
            configuration.setMaxAge(600L);
            source.registerCorsConfiguration(path, configuration);
        }
        return source;
    }
}
