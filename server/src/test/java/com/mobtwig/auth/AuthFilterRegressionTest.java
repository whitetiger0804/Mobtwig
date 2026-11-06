package com.mobtwig.auth;

import java.util.concurrent.ConcurrentHashMap;
import jakarta.servlet.Filter;
import jakarta.servlet.http.Cookie;
import com.mobtwig.admin.*;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.MapSession;
import org.springframework.session.MapSessionRepository;
import org.springframework.session.config.annotation.web.http.EnableSpringHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** 실제 필터 체인·Spring Session의 연결을 인메모리 세션으로 검사합니다. DB 역할 회귀는 CI가 별도 검사합니다. */
class AuthFilterRegressionTest {
    @Configuration @EnableWebMvc @EnableWebSecurity @EnableSpringHttpSession
    @Import({MemberWebSecurity.class, AdminSecurity.class, MemberCsrfController.class, AdminController.class})
    static class Config {
        @Bean AuthCookies authCookies() { return new AuthCookies(false); }
        @Bean MapSessionRepository sessionRepository() { return new MapSessionRepository(new ConcurrentHashMap<String, org.springframework.session.Session>()); }
        @Bean AdminCatalog catalog() { return mock(AdminCatalog.class); }
        @Bean AdminAccounts accounts(PasswordEncoder passwords) {
            var accounts = mock(AdminAccounts.class);
            when(accounts.loadUserByUsername("admin@example.test")).thenReturn(User.withUsername("1").password(passwords.encode("admin-password123")).roles("ADMIN").build());
            when(accounts.loadUserByUsername("user@example.test")).thenReturn(User.withUsername("2").password(passwords.encode("member-password123")).roles("USER").build());
            when(accounts.isAdmin("1")).thenReturn(true);
            when(accounts.session("1")).thenReturn(new AdminAccounts.Session(1, "admin@example.test", "관리자"));
            return accounts;
        }
    }

    @Test void independentMemberCsrfDoesNotBreakAdminLoginOrAllowCookieSwaps() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context); var mapper = new ObjectMapper();
            var adminCsrf = mvc.perform(get("/api/admin/csrf")).andReturn().getResponse();
            var a = cookie(adminCsrf, "SESSION"); String token = mapper.readTree(adminCsrf.getContentAsString()).get("token").asString();
            var signedIn = mvc.perform(post("/api/admin/login").cookie(a).header("X-CSRF-TOKEN", token)
                    .param("username", "admin@example.test").param("password", "admin-password123")).andReturn().getResponse();
            assertEquals(204, signedIn.getStatus());
            var authenticated = cookie(signedIn, "SESSION"); assertNotEquals(a.getValue(), authenticated.getValue());
            assertEquals(200, mvc.perform(get("/api/admin/session").cookie(authenticated)).andReturn().getResponse().getStatus());
            var memberCsrf = mvc.perform(get("/api/auth/csrf").cookie(authenticated)).andReturn().getResponse();
            assertEquals(200, memberCsrf.getStatus()); var m = cookie(memberCsrf, "MEMBER_SESSION");
            assertEquals(401, mvc.perform(get("/api/auth/csrf").cookie(new Cookie("MEMBER_SESSION", authenticated.getValue()))).andReturn().getResponse().getStatus());
            assertEquals(401, mvc.perform(get("/api/admin/session").cookie(new Cookie("SESSION", m.getValue()))).andReturn().getResponse().getStatus());
            assertEquals(200, mvc.perform(get("/api/admin/session").cookie(authenticated, m)).andReturn().getResponse().getStatus());
            assertEquals(200, mvc.perform(get("/api/auth/csrf").cookie(authenticated, m)).andReturn().getResponse().getStatus());
            assertEquals(403, mvc.perform(post("/api/auth/signup").cookie(m).header("X-CSRF-TOKEN", token)
                    .contentType("application/json").content("{}")).andReturn().getResponse().getStatus());
        }
    }

    @Test void normalAccountsStillCannotUseAdministratorApis() throws Exception {
        try (var context = context()) {
            var mvc = mvc(context); var csrf = mvc.perform(get("/api/admin/csrf")).andReturn().getResponse();
            var response = mvc.perform(post("/api/admin/login").cookie(cookie(csrf, "SESSION"))
                    .header("X-CSRF-TOKEN", new ObjectMapper().readTree(csrf.getContentAsString()).get("token").asString())
                    .param("username", "user@example.test").param("password", "member-password123")).andReturn().getResponse();
            assertEquals(204, response.getStatus());
            assertEquals(403, mvc.perform(get("/api/admin/catalog").cookie(cookie(response, "SESSION"))).andReturn().getResponse().getStatus());
        }
    }

    private AnnotationConfigWebApplicationContext context() {
        var context = new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext());
        context.register(Config.class); context.refresh(); return context;
    }
    private MockMvc mvc(AnnotationConfigWebApplicationContext context) {
        return MockMvcBuilders.webAppContextSetup(context).addFilters(
                context.getBean("springSessionRepositoryFilter", Filter.class), context.getBean("springSecurityFilterChain", Filter.class)).build();
    }
    private Cookie cookie(MockHttpServletResponse response, String name) {
        String header = response.getHeaders("Set-Cookie").stream().filter(value -> value.startsWith(name + "=")).findFirst().orElseThrow();
        return new Cookie(name, header.substring(name.length() + 1, header.indexOf(';')));
    }
}
