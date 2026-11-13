package com.mobtwig.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 실제 약관 원문·검증·HTTP JSON을 DB 접근과 분리해 검사합니다. */
class MemberSignupContractTest {
    private static final String PASSWORD = "Abcdef12";
    private static final ValidatorFactory VALIDATION = Validation.buildDefaultValidatorFactory();
    private final SignupPolicies policies = new SignupPolicies(true);
    private final MemberSignupRepository repository = mock(MemberSignupRepository.class);
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(4);
    private final ObjectMapper mapper = new ObjectMapper();

    @AfterAll static void closeValidation() { VALIDATION.close(); }

    @Test void showsAndStoresTheSameDocumentAndReturnsOnlySignupInformation() throws Exception {
        var mvc = mvc(policies);
        var terms = mvc.perform(get("/api/auth/terms")).andExpect(status().isOk()).andReturn().getResponse();
        assertEquals("no-store", terms.getHeader("Cache-Control"));
        assertContract("/api/auth/terms", Request.Method.GET, 200, terms.getContentAsString(StandardCharsets.UTF_8));
        var documents = mapper.readTree(terms.getContentAsString(StandardCharsets.UTF_8)).get("documents");
        for (var doc : documents) {
            String body = doc.get("body").asString();
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));
            assertTrue(body.contains("임시"));
            assertEquals(doc.get("contentHash").asString(), hash);
        }
        when(repository.insertMember(eq("reader@example.test"), eq("시연 회원"), anyString())).thenReturn(9007199254740993L);
        var created = mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(valid())))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value("9007199254740993"))
                .andExpect(jsonPath("$.email").value("reader@example.test"))
                .andExpect(jsonPath("$.nickname").value("시연 회원")).andReturn().getResponse();
        assertContract("/api/auth/signup", Request.Method.POST, 201, created.getContentAsString(StandardCharsets.UTF_8));
        assertEquals("no-store", created.getHeader("Cache-Control"));
        var hash = ArgumentCaptor.forClass(String.class);
        verify(repository).insertMember(eq("reader@example.test"), eq("시연 회원"), hash.capture());
        assertTrue(passwords.matches(PASSWORD, hash.getValue()));
        verify(repository).insertReadingSettings(9007199254740993L);
        verify(repository).insertConsents(eq(9007199254740993L), eq(policies.current()), any(Instant.class));
    }

    @Test void rejectsInvalidFieldsMissingConsentAndInjectedRoleBeforeAnyWrite() throws Exception {
        var input = valid();
        input.put("email", "not-an-email"); input.put("nickname", "\u00a0"); input.put("password", "abc1");
        input.put("passwordConfirmation", "different"); input.put("role", "ADMIN");
        input.put("consents", List.of(consent(policies.current().getFirst(), false)));
        var result = mvc(policies).perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(input)))
                .andExpect(status().isBadRequest()).andReturn().getResponse();
        var body = result.getContentAsString(StandardCharsets.UTF_8);
        assertContract("/api/auth/signup", Request.Method.POST, 400, body);
        var errors = mapper.readTree(body).get("fieldErrors");
        for (String field : List.of("email", "nickname", "password", "passwordConfirmation", "terms", "privacy", "request")) {
            assertTrue(errors.has(field), field);
        }
        assertFalse(body.contains("not-an-email"));
        assertFalse(body.contains("different"));
        assertFalse(body.contains("ADMIN"));
        verifyNoInteractions(repository);
    }

    @Test void rejectsStaleVersionAndHashThenReportsDuplicatesByField() throws Exception {
        var input = valid();
        var terms = consent(policies.current().getFirst(), true);
        terms.put("version", "older-demo");
        var privacy = consent(policies.current().getLast(), true);
        privacy.put("contentHash", "0".repeat(64));
        input.put("consents", List.of(terms, privacy));
        var mvc = mvc(policies);
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(input)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.fieldErrors.terms").exists())
                .andExpect(jsonPath("$.fieldErrors.privacy").exists());
        verifyNoInteractions(repository);

        when(repository.duplicates("reader@example.test", "시연 회원")).thenReturn(Map.of("email", "중복 이메일", "nickname", "중복 닉네임"));
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(valid())))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.fieldErrors.email").exists())
                .andExpect(jsonPath("$.fieldErrors.nickname").exists());
        verify(repository, never()).insertMember(anyString(), anyString(), anyString());
    }

    @Test void acceptsExactly72Utf8BytesAndRejects73WithoutTruncation() throws Exception {
        String atLimit = "Ab12" + "한".repeat(22) + "cd";
        assertEquals(72, atLimit.getBytes(StandardCharsets.UTF_8).length);
        var input = valid();
        input.put("password", atLimit); input.put("passwordConfirmation", atLimit);
        when(repository.insertMember(anyString(), anyString(), anyString())).thenReturn(1L);
        var mvc = mvc(policies);
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(input)))
                .andExpect(status().isCreated());
        input.put("password", atLimit + "x"); input.put("passwordConfirmation", atLimit + "x");
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(input)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.password").exists());
        verify(repository, times(1)).insertMember(anyString(), anyString(), anyString());
    }

    @Test void deniesBothEndpointsWhenTheDemoSettingIsDisabled() throws Exception {
        var mvc = mvc(new SignupPolicies(false));
        mvc.perform(get("/api/auth/terms")).andExpect(status().isServiceUnavailable());
        mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(valid())))
                .andExpect(status().isServiceUnavailable());
        verifyNoInteractions(repository);
    }

    private MockMvc mvc(SignupPolicies currentPolicies) {
        var service = new MemberSignupService(currentPolicies, repository, passwords, VALIDATION.getValidator());
        return MockMvcBuilders.standaloneSetup(new MemberSignupController(currentPolicies, service)).build();
    }

    private Map<String, Object> valid() {
        return new LinkedHashMap<>(Map.of("email", "  Reader@Example.Test ", "nickname", " 시연 회원 ",
                "password", PASSWORD, "passwordConfirmation", PASSWORD,
                "consents", policies.current().stream().map(doc -> consent(doc, true)).toList()));
    }

    private Map<String, Object> consent(SignupPolicies.Document doc, boolean agreed) {
        return new LinkedHashMap<>(Map.of("kind", doc.kind(), "version", doc.version(), "contentHash", doc.contentHash(), "agreed", agreed));
    }

    private void assertContract(String path, Request.Method method, int status, String body) throws Exception {
        String spec = new ClassPathResource("static/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        var report = OpenApiInteractionValidator.createForInlineApiSpecification(spec).build().validateResponse(path, method,
                SimpleResponse.Builder.status(status).withContentType("application/json").withBody(body).build());
        assertFalse(report.hasErrors(), () -> report.getMessages().toString());
    }

}
