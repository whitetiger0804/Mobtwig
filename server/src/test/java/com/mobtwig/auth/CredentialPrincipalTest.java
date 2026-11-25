package com.mobtwig.auth;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

class CredentialPrincipalTest {
    @Test void retainsOnlyLoginVersionAfterCredentialErasureAndSessionSerialization() throws Exception {
        var passwords = new BCryptPasswordEncoder(4);
        var hash = passwords.encode("original-password123");
        var principal = new CredentialPrincipal("42", hash, "USER", true);
        principal.eraseCredentials();
        assertNull(principal.getPassword());
        var bytes = new ByteArrayOutputStream();
        try (var output = new ObjectOutputStream(bytes)) { output.writeObject(principal); }
        String serialized = bytes.toString(StandardCharsets.ISO_8859_1);
        assertFalse(serialized.contains(hash)); assertFalse(serialized.contains("original-password123"));
        try (var input = new ObjectInputStream(new ByteArrayInputStream(bytes.toByteArray()))) {
            var restored = (CredentialPrincipal) input.readObject();
            assertTrue(restored.matchesVersion(hash));
            assertFalse(restored.matchesVersion(passwords.encode("next-password456")));
            assertNull(restored.getPassword());
            assertEquals("42", restored.getUsername());
        }
    }
}
