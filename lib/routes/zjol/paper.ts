import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import InvalidParameterError from '@/errors/types/invalid-parameter';

export const route: Route = {
    path: '/paper/:id?',
    categories: ['traditional-media'],
    example: '/zjol/paper/zjrb',
    parameters: { id: '报纸 id，见下表，默认为 `zjrb`，即浙江日报' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '浙报集团系列报刊',
    maintainers: ['nczitzk'],
    handler,
    description: `| 浙江日报 | 钱江晚报 | 美术报 | 浙江老年报 | 浙江法制报 | 江南游报 |
| -------- | -------- | ------ | ---------- | ---------- | -------- |
| zjrb     | qjwb     | msb    | zjlnb      | zjfzb      | jnyb     |`,
};

async function handler(ctx) {
    const id = ctx.req.param('id') ?? 'zjrb';
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 100;

    const allowedId = ['zjrb', 'qjwb', 'msb', 'zjlnb', 'zjfzb', 'jnyb'];
    if (!allowedId.includes(id)) {
        throw new InvalidParameterError('id not allowed');
    }

    const query = id === 'jnyb' ? 'map[name="PagePicMap"] area' : 'ul.main-ed-articlenav-list li a';

    const rootUrl = id === 'qjwb' ? 'http://qjwb.thehour.cn' : `https://${id}.zjol.com.cn`;
    let currentUrl = `${rootUrl}/paperindex.htm`;

    let response = await got({
        method: 'get',
        url: currentUrl,
    });

    const url = response.data.match(/URL=(.*)"/)[1];
    const pubDate = parseDate(url.match(/(\d{4}-\d{2}\/\d{2})/)[1], 'YYYY-MM/DD');

    currentUrl = `${rootUrl}/${url.replace(`/${url.split('/').pop()}`, '')}`;

    response = await got({
        method: 'get',
        url: `${rootUrl}/${url}`,
    });

    const $ = load(response.data);

    let items = $(query)
        .toArray()
        .map((a) => `${currentUrl}/${$(a).attr('href')}`);

    await Promise.all(
        $('#pageLink')
            .slice(1)
            .toArray()
            .map((p) => `${currentUrl}/${$(p).attr('href')}`)
            .map(async (p) => {
                const pageResponse = await got({
                    method: 'get',
                    url: p,
                });

                const page = load(pageResponse.data);

                items.push(
                    ...page(query)
                        .toArray()
                        .map((a) => `${currentUrl}/${page(a).attr('href')}`)
                );
            })
    );

    items = await Promise.all(
        items
            .filter((a) => (id === 'jnyb' ? /\?div=1$/.test(a) : true))
            .slice(0, limit)
            .map((link) =>
                cache.tryGet(link, async () => {
                    const detailResponse = await got({
                        method: 'get',
                        url: link,
                    });

                    const content = load(detailResponse.data);

                    const title = content('.main-article-title').text();

                    content('.main-article-alltitle').remove();

                    return {
                        title,
                        pubDate,
                        link: link.split('?')[0],
                        description: content('.main-article-content').html(),
                    };
                })
            )
    );

    return {
        title: $('title').text(),
        link: rootUrl,
        item: items,
    };
}
