package com.mobtwig.work;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 작품에 연결된 저자의 표시 이름을 매핑합니다. */
@Entity
@Table(name = "author")
public class Author {
    @Id
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    /** JPA가 저자를 생성합니다. */
    protected Author() { }

    /** 저자의 표시 이름을 반환합니다.
     * @return 저자의 표시 이름입니다. */
    public String getName() { return name; }
}
