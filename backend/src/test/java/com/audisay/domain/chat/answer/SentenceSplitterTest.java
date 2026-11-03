package com.audisay.domain.chat.answer;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SentenceSplitterTest {

    @Test
    void 조각이_나뉘어_와도_문장_끝에서_자른다() {
        SentenceSplitter splitter = new SentenceSplitter();
        List<String> out = new ArrayList<>();

        out.addAll(splitter.add("골을 넣은 사람은 "));
        out.addAll(splitter.add("손흥민이에요."));
        assertThat(out).isEmpty();
        out.addAll(splitter.add(" 왼발로 찼어요. 관"));
        out.addAll(splitter.add("중이 환호해요"));
        splitter.flush().ifPresent(out::add);

        assertThat(out).containsExactly("골을 넣은 사람은 손흥민이에요.", "왼발로 찼어요.", "관중이 환호해요");
    }

    @Test
    void 숫자_사이_점은_문장_끝이_아니다() {
        SentenceSplitter splitter = new SentenceSplitter();

        List<String> out = splitter.add("시속 60마일까지 0.81초 걸렸어요. 정말 빨라요! ");

        assertThat(out).containsExactly("시속 60마일까지 0.81초 걸렸어요.", "정말 빨라요!");
        assertThat(splitter.flush()).isEmpty();
    }

    @Test
    void 물음표_말줄임표_닫는_따옴표도_문장_끝이다() {
        SentenceSplitter splitter = new SentenceSplitter();

        List<String> out = splitter.add("\"멋지다!\" 하고 외쳐요… 누구일까요?\n");

        assertThat(out).containsExactly("\"멋지다!\"", "하고 외쳐요…", "누구일까요?");
    }

    @Test
    void 남은_글자가_없으면_flush는_비어_있다() {
        SentenceSplitter splitter = new SentenceSplitter();
        splitter.add("   ");

        assertThat(splitter.flush()).isEmpty();
    }
}
