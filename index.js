const puppeteer = require('puppeteer');
const fs = require('fs');
const { parse } = require('json2csv');
require('dotenv').config();

const proxies = {
    'session_1': 'http://186.234.124.127:8080',
    'session_2': 'http://116.228.227.211:443',
    'session_3': 'http://23.152.40.15:3128',
};

class Puppeteer {
    constructor() {
        this.browser = null;
        this.page = null;
        this.linkedinPage = null;
        this.width = 1920;
        this.height = 1080;
    }

    async launch(url, proxy) {
        try {
            this.browser = await puppeteer.launch({
                headless: false,
                args: [`--proxy-server=${proxy}`],
            });
            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: this.width, height: this.height });
            await this.page.goto(url);
            return ({
                status: 'success',
                message: 'Browser launched successfully!'
            })
        } catch (error) {
            console.log("Error when launching browser!")
            return this.error(error);
        }
    }

    async close() {
        await this.browser.close();
    }

    async wait(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async error(message) {
        console.log(message)
        return ({
            status: 'failed',
            message: message
        })
    }

    async appendToFile(filePath, data) {
        try {
            if(fs.existsSync(filePath))
                fs.appendFileSync(filePath, data + "\n");
            else
                fs.writeFileSync(filePath, data + "\n");
            return ({
                status: 'success',
                message: 'Write to file successfully!'
            })
        } catch (error) {
            console.log("Error when writing to file!")
            return this.error(error);
        }
    }

    async login() {
        try {
            const url = 'https://linkedin.com/';
            this.linkedinPage = await this.browser.newPage();
            await this.linkedinPage.goto(url);
            await this.linkedinPage.waitForSelector('input[name="session_key"]');
            await this.linkedinPage.type('input[name="session_key"]', process.env.EMAIL);
            await this.linkedinPage.type('input[name="session_password"]', process.env.PASSWORD);
            await this.wait(5000);
            await this.linkedinPage.click('button[type="submit"]');

            while (this.linkedinPage.url().includes('checkpoint')) {
                console.log('Checkpoint! Please verify your account!');
                await this.wait(5000);
                if (this.linkedinPage.url().includes('feed'))
                    break;
            }

            return ({
                status: 'success',
                message: 'Log in successfully!',
                url: this.linkedinPage.url()
            })
        } catch (error) {
            console.log("Error when log in!")
            return this.error(error);
        }
    }

    async makeSearchRequest(keyword) {
        await this.page.waitForSelector('textarea[name="q"]');
        await this.page.type('textarea[name="q"]', keyword);
        await this.page.keyboard.press('Enter');
        await this.page.waitForNavigation({ waitUntil: 'load' });
        return await this.page.url();
    }

    async searchPeople(url) {
        try {
            await this.page.goto(url);

            // Scroll to the end of the page
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            const links = await this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a'))
                    .filter(el => el.getAttribute('href')?.includes('/in/')
                        && !el.getAttribute('href')?.includes('translate'));
                return elements.map(el => el.getAttribute('href'));
            });

            return ({
                status: 'success',
                message: 'Search successfully!',
                url: this.page.url(),
                links: links,
            });
        } catch (error) {
            console.log("Error when search!");
            return this.error(error);
        }
    }

    async getPeopleAlsoViewed(link) {
        try {
            await this.linkedinPage.goto(link);
            // Wait for the page to load
            await this.wait(5000);

            const selector = await this.linkedinPage.waitForSelector('#navigation-overlay-section-see-more');
            if (selector) {
                await this.linkedinPage.click('#navigation-overlay-section-see-more');
                await this.linkedinPage.waitForNavigation({ waitUntil: 'load' });
            }

            const peopleAlsoViewed = await this.linkedinPage.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a[data-field="browsemap_card_click"]'));
                return elements
                    .filter(el => !el.getAttribute('href').includes('miniProfileUrn'))
                    .map(el => el.getAttribute('href'));
            });

            return [...new Set(peopleAlsoViewed)];
        } catch (error) {
            return null;
        }
    }

    async getProfile(link) {
        try {
            await this.linkedinPage.setViewport({ width: this.width, height: this.height });
            await this.linkedinPage.goto(link);
            // Wait for the page to load
            await this.wait(5000);
            // Get profile
            const profile = await this.linkedinPage.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);

                const name = document.querySelector("h1.text-heading-xlarge");
                const title = document.querySelector('div.text-body-medium');
                const company = document.querySelector('div.inline-show-more-text');

                const formatData = {
                    Name: name ? name.innerText : '',
                    Title: title ? title.innerText : '',
                    Company: company ? company.innerText : '',
                    URL: window.location.href,
                };
                return { formatData }
            });
            return ({
                status: 'success',
                message: 'Get profile successfully!',
                url: this.linkedinPage.url(),
                profile: profile
            });
        } catch (error) {
            console.log("Error when get profile!")
            return this.error(error);
        }
    }

    async getPageInfo() {
        await this.page.waitForSelector('#pnnext');
        await this.page.click('#pnnext');
        await this.page.waitForNavigation({ waitUntil: 'load' });
        const currentPage = await this.page.url();
        const nextPage = await this.page.evaluate((element) => {
            return document.querySelector('#pnnext')?.href;
        });

        return { nextPage, currentPage };
    }
}

const scraper = new Puppeteer();

(async () => {
    await scraper.launch('https://www.google.com', proxies.session_1);

    await scraper.wait(5000);

    let userInfo = [];

    await scraper.login();

    let currentPage = await scraper.makeSearchRequest('site:il.linkedin.com "CTO + Israel"');

    const profileQueue = [];
    let lastPage = false;
    let pageInfo = { currentPage, nextPage: null };
    while (pageInfo.currentPage) {
        const usersLink= await scraper.searchPeople(pageInfo.currentPage);
        console.log('userLink', usersLink)
        for (let i = 0; i < usersLink.links?.length; i++) {
            const link = usersLink.links[i];
            const profile = await scraper.getProfile(link);
            const peopleAlsoViewed = await scraper.getPeopleAlsoViewed(link);
            if (peopleAlsoViewed) {
                profileQueue.push(...peopleAlsoViewed);
            }
            userInfo.push(profile.profile.formatData);
        }

        if (lastPage) break;
        pageInfo = await scraper.getPageInfo();
        if (!pageInfo.nextPage) {
            lastPage = true;
        }
    }

    await scraper.close();

    await scraper.launch('https://linkedin.com/', proxies.session_3);

    await scraper.login();

    for (let i = 0; i < profileQueue.length; i++) {
        const link = profileQueue[i];
        const profile = await scraper.getProfile(link);
        userInfo.push(profile.profile.formatData);
    }

    let fileName = "data.csv";
    let data = parse(userInfo, { header: true });
    await scraper.appendToFile(fileName, data);

    await scraper.close();
})();
